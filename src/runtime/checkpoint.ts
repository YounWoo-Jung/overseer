import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { recordEvent } from '../state/event-store.js';

export interface CheckpointRecord {
  id: string;
  timestamp: string;
  message: string;
}

const STATE_DIR = '.overseer';
const CHECKPOINT_DIR = 'checkpoints';
const SHADOW_GIT_DIR = 'shadow.git';

const EXCLUDES = [
  '.git/',
  '.overseer/',
  'node_modules/',
  'dist/',
  'build/',
  '.next/',
  'coverage/',
  '.env',
  '.env.*',
  '*.log',
];

function checkpointRoot(projectDir: string): string {
  return join(resolve(projectDir), STATE_DIR, CHECKPOINT_DIR);
}

function shadowGitDir(projectDir: string): string {
  return join(checkpointRoot(projectDir), SHADOW_GIT_DIR);
}

function ensureCheckpointRepo(projectDir: string): void {
  const root = resolve(projectDir);
  const shadow = shadowGitDir(root);
  mkdirSync(checkpointRoot(root), { recursive: true });
  if (!existsSync(join(shadow, 'HEAD'))) {
    execFileSync('git', ['-c', 'init.defaultBranch=main', 'init', '--bare', shadow], { cwd: root, encoding: 'utf-8' });
    execFileSync('git', ['config', 'user.email', 'overseer@local'], { cwd: root, env: gitEnv(root), encoding: 'utf-8' });
    execFileSync('git', ['config', 'user.name', 'Overseer Checkpoint'], { cwd: root, env: gitEnv(root), encoding: 'utf-8' });
    execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: root, env: gitEnv(root), encoding: 'utf-8' });
  }
  writeFileSync(join(shadow, 'info', 'exclude'), `${EXCLUDES.join('\n')}\n`);
}

function gitEnv(projectDir: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_DIR: shadowGitDir(projectDir),
    GIT_WORK_TREE: resolve(projectDir),
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
  };
}

function runGit(projectDir: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: resolve(projectDir),
    env: gitEnv(projectDir),
    encoding: 'utf-8',
    maxBuffer: 4 * 1024 * 1024,
    timeout: 60_000,
  }).trim();
}

export function createCheckpoint(projectDir: string, message: string): { success: boolean; id?: string; message: string } {
  const root = resolve(projectDir);
  try {
    ensureCheckpointRepo(root);
    runGit(root, ['add', '-A', '--', '.']);
    runGit(root, ['commit', '--allow-empty', '-m', message.slice(0, 180)]);
    const id = runGit(root, ['rev-parse', '--short=12', 'HEAD']);
    recordEvent(root, {
      type: 'checkpoint.created',
      severity: 'info',
      provenance: { source: 'system' },
      payload: { id, message },
    });
    return { success: true, id, message: 'checkpoint created' };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    recordEvent(root, {
      type: 'checkpoint.failed',
      severity: 'warning',
      provenance: { source: 'system' },
      payload: { message, error: detail },
    });
    return { success: false, message: detail };
  }
}

export function listCheckpoints(projectDir: string, limit = 20): CheckpointRecord[] {
  const root = resolve(projectDir);
  if (!existsSync(join(shadowGitDir(root), 'HEAD'))) return [];
  try {
    const output = runGit(root, ['log', `-${limit}`, '--format=%h%x09%cI%x09%s']);
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [id, timestamp, ...message] = line.split('\t');
        return { id, timestamp, message: message.join('\t') };
      });
  } catch {
    return [];
  }
}

export function restoreCheckpoint(projectDir: string, id: string): { success: boolean; message: string } {
  const root = resolve(projectDir);
  if (!/^[0-9a-fA-F]{4,64}$/.test(id)) return { success: false, message: 'invalid checkpoint id' };
  if (!existsSync(join(shadowGitDir(root), 'HEAD'))) return { success: false, message: 'no checkpoint repo' };

  try {
    const checkpoint = runGit(root, ['rev-parse', '--verify', `${id}^{commit}`]);
    createCheckpoint(root, `pre-restore ${id}`);
    runGit(root, ['reset', '--hard', checkpoint]);
    recordEvent(root, {
      type: 'checkpoint.restored',
      severity: 'warning',
      provenance: { source: 'user' },
      payload: { id: checkpoint.slice(0, 12) },
    });
    return { success: true, message: `restored ${checkpoint.slice(0, 12)}` };
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : String(error) };
  }
}

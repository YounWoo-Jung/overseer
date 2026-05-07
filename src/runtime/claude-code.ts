import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { appendAssist, appendHistory } from '../state/history-store.js';
import { recordEvent } from '../state/event-store.js';
import { compactText, estimateTokens, readTokenBudget } from './token-budget.js';
import { redactSecrets } from './redact.js';

export interface ClaudeCodeStatus {
  home: string;
  exists: boolean;
  settingsPath: string;
  hasUserMemory: boolean;
  skipDangerousModePermissionPrompt: boolean;
  enabledPlugins: number;
  projectMemoryPath: string;
  projectMemoryFiles: number;
  userComponents: {
    commands: number;
    skills: number;
    agents: number;
    rules: number;
  };
}

interface ClaudeHookInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name?: string;
  permission_mode?: string;
  tool_name?: string;
  tool_input?: unknown;
  [key: string]: unknown;
}

const CLAUDE_HOME = process.env.CLAUDE_HOME || join(homedir(), '.claude');
const SENSITIVE_NAME_RE = /(credential|secret|token|password|passwd|auth|private[_-]?key|api[_-]?key)/i;

function safeRead(path: string): string {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return '';
  }
}

function safeReadJson(path: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function countFiles(path: string, predicate: (name: string) => boolean): number {
  if (!existsSync(path)) return 0;
  let count = 0;
  for (const name of readdirSync(path)) {
    const next = join(path, name);
    let stat;
    try {
      stat = statSync(next);
    } catch {
      continue;
    }
    if (stat.isDirectory()) count += countFiles(next, predicate);
    else if (stat.isFile() && predicate(next)) count += 1;
  }
  return count;
}

function projectKey(projectDir: string): string {
  return resolve(projectDir).replace(/[\\/]+/g, '-');
}

function projectMemoryDir(projectDir: string): string {
  return join(CLAUDE_HOME, 'projects', projectKey(projectDir), 'memory');
}

function listMemoryFiles(projectDir: string): string[] {
  const dir = projectMemoryDir(projectDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md') && !SENSITIVE_NAME_RE.test(name))
    .map((name) => join(dir, name))
    .filter((path) => {
      try {
        return statSync(path).isFile();
      } catch {
        return false;
      }
    })
    .sort();
}

function extractDescription(content: string): string {
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
  const desc = frontmatter?.[1].match(/^description:\s*["']?(.+?)["']?\s*$/m)?.[1];
  if (desc) return desc.trim();
  const heading = content.split('\n').find((line) => line.startsWith('# '));
  const bullet = content.split('\n').find((line) => /^[-*]\s+/.test(line.trim()));
  return (bullet ?? heading ?? 'Claude Code component').replace(/^[-*#\s]+/, '').trim();
}

function listComponents(root: string, kind: 'commands' | 'skills' | 'agents' | 'rules'): string[] {
  const dir = join(root, kind);
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  const walk = (path: string) => {
    for (const name of readdirSync(path)) {
      const next = join(path, name);
      let stat;
      try {
        stat = statSync(next);
      } catch {
        continue;
      }
      if (stat.isDirectory()) walk(next);
      else if (stat.isFile() && (name === 'SKILL.md' || name.endsWith('.md'))) files.push(next);
    }
  };
  walk(dir);
  return files.sort();
}

export function readClaudeCodeStatus(projectDir: string): ClaudeCodeStatus {
  const settingsPath = join(CLAUDE_HOME, 'settings.json');
  const settings = safeReadJson(settingsPath);
  const enabledPlugins = settings.enabledPlugins && typeof settings.enabledPlugins === 'object'
    ? Object.keys(settings.enabledPlugins as Record<string, unknown>).length
    : 0;
  const memoryPath = projectMemoryDir(projectDir);

  return {
    home: CLAUDE_HOME,
    exists: existsSync(CLAUDE_HOME),
    settingsPath,
    hasUserMemory: existsSync(join(CLAUDE_HOME, 'CLAUDE.md')),
    skipDangerousModePermissionPrompt: settings.skipDangerousModePermissionPrompt === true,
    enabledPlugins,
    projectMemoryPath: memoryPath,
    projectMemoryFiles: listMemoryFiles(projectDir).length,
    userComponents: {
      commands: listComponents(CLAUDE_HOME, 'commands').length,
      skills: listComponents(CLAUDE_HOME, 'skills').length,
      agents: listComponents(CLAUDE_HOME, 'agents').length,
      rules: listComponents(CLAUDE_HOME, 'rules').length,
    },
  };
}

export function buildClaudeCodeContextBlock(projectDir: string, matchContext: string): string {
  const status = readClaudeCodeStatus(projectDir);
  if (!status.exists) return '';
  const budget = readTokenBudget();
  const userMemory = safeRead(join(CLAUDE_HOME, 'CLAUDE.md'));
  const memoryFiles = listMemoryFiles(projectDir);
  const components = [
    ...listComponents(CLAUDE_HOME, 'skills').slice(0, 8),
    ...listComponents(CLAUDE_HOME, 'agents').slice(0, 6),
    ...listComponents(CLAUDE_HOME, 'rules').slice(0, 6),
    ...listComponents(CLAUDE_HOME, 'commands').slice(0, 6),
  ].map((path) => {
    const raw = safeRead(path);
    return `- ${basename(dirname(path))}/${basename(path)}: ${extractDescription(raw).slice(0, 180)}`;
  });
  const matchedMemory = memoryFiles
    .filter((path) => basename(path) === 'MEMORY.md' || matchContext.includes(basename(path, '.md')))
    .slice(0, 3)
    .map((path) => `## ${basename(path)}\n${compactText(redactSecrets(safeRead(path)), 500, 'tail')}`);

  return compactText([
    '# Claude Code local context',
    `home: ${status.home}`,
    `dangerous prompt skip: ${status.skipDangerousModePermissionPrompt ? 'on' : 'off'}`,
    `project memory files: ${status.projectMemoryFiles}`,
    userMemory && `## user CLAUDE.md\n${compactText(redactSecrets(userMemory), 700, 'tail')}`,
    components.length && `## user components\n${components.join('\n')}`,
    matchedMemory.length && `## project auto memory\n${matchedMemory.join('\n\n')}`,
  ].filter(Boolean).join('\n\n'), Math.min(budget.maxSectionTokens, 1500), 'tail');
}

export function importClaudeCodeMemory(projectDir: string): { imported: number; path: string } {
  const files = listMemoryFiles(projectDir).slice(0, 12);
  const path = projectMemoryDir(projectDir);
  if (files.length === 0) return { imported: 0, path };
  const budget = readTokenBudget();
  const lines = files.map((file) => {
    const raw = compactText(redactSecrets(safeRead(file)), Math.min(600, budget.maxHistoryTokens), 'tail');
    return `${basename(file)} (${estimateTokens(raw)} tokens)\n${raw}`;
  });
  appendAssist(projectDir, 'claude memory imported', lines);
  appendHistory(projectDir, {
    kind: 'note',
    title: 'Claude Code memory imported',
    detail: `Imported ${files.length} memory files from ${path}.`,
    files: files.map((file) => file.replace(`${path}/`, '')),
  });
  return { imported: files.length, path };
}

export function recordClaudeCodeHook(projectDir: string, input: ClaudeHookInput): void {
  const eventName = String(input.hook_event_name || 'unknown');
  const severity = eventName === 'PermissionRequest' || eventName.includes('Failure') ? 'warning' : 'info';
  const payload = summarizeHookInput(input);
  recordEvent(projectDir, {
    type: `claude.${eventName}`,
    severity,
    provenance: { source: 'agent', command: 'claude' },
    payload,
  });
  if (severity !== 'info') {
    appendAssist(projectDir, `claude ${eventName}`, [
      input.cwd ? `cwd: ${input.cwd}` : '',
      input.tool_name ? `tool: ${input.tool_name}` : '',
      payload.toolInput ? `input: ${payload.toolInput}` : '',
    ].filter(Boolean));
  }
}

function summarizeHookInput(input: ClaudeHookInput): Record<string, unknown> {
  const toolInput = input.tool_input === undefined ? '' : compactText(redactSecrets(JSON.stringify(input.tool_input)), 500, 'middle');
  return {
    sessionId: input.session_id,
    transcript: typeof input.transcript_path === 'string' ? basename(input.transcript_path) : undefined,
    cwd: input.cwd,
    event: input.hook_event_name,
    permissionMode: input.permission_mode,
    toolName: input.tool_name,
    toolInput,
  };
}

export function ensureClaudeHookDir(): string {
  const path = join(CLAUDE_HOME, 'hooks');
  mkdirSync(path, { recursive: true });
  return path;
}

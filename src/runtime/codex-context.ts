import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { appendAssist, appendHistory } from '../state/history-store.js';
import { recordEvent } from '../state/event-store.js';
import { compactText, readTokenBudget } from './token-budget.js';
import { redactSecrets } from './redact.js';

export interface CodexStatus {
  home: string;
  exists: boolean;
  configPath: string;
  hasGlobalAgents: boolean;
  defaultPermissions?: string;
  hooksEnabled: boolean;
  memoriesEnabled: boolean;
  memoryFiles: number;
  userSkills: number;
  systemSkills: number;
  rules: number;
  sessionFiles: number;
}

interface CodexHookInput {
  session_id?: string;
  transcript_path?: string | null;
  cwd?: string;
  hook_event_name?: string;
  model?: string;
  tool_name?: string;
  tool_input?: unknown;
  [key: string]: unknown;
}

const CODEX_HOME = process.env.CODEX_HOME || join(homedir(), '.codex');
const USER_SKILLS_DIR = join(homedir(), '.agents', 'skills');
const SENSITIVE_NAME_RE = /(credential|secret|token|password|passwd|auth|private[_-]?key|api[_-]?key)/i;

function safeRead(path: string): string {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return '';
  }
}

function countFiles(path: string, predicate: (path: string) => boolean): number {
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

function parseToml(raw: string): Record<string, string> {
  const values: Record<string, string> = {};
  let section = '';
  for (const line of raw.split('\n')) {
    const clean = line.replace(/\s+#.*$/, '').trim();
    if (!clean) continue;
    const sectionMatch = clean.match(/^\[([^\]]+)]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    const kv = clean.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!kv) continue;
    const key = section ? `${section}.${kv[1]}` : kv[1];
    values[key] = kv[2].trim().replace(/^"|"$/g, '');
  }
  return values;
}

function boolValue(value: string | undefined): boolean {
  return value === 'true';
}

function listSkillFiles(path: string): string[] {
  if (!existsSync(path)) return [];
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const next = join(dir, name);
      let stat;
      try {
        stat = statSync(next);
      } catch {
        continue;
      }
      if (stat.isDirectory()) walk(next);
      else if (stat.isFile() && name === 'SKILL.md') files.push(next);
    }
  };
  walk(path);
  return files.sort();
}

function listMemoryFiles(): string[] {
  const dir = join(CODEX_HOME, 'memories');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => !SENSITIVE_NAME_RE.test(name))
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
  const name = frontmatter?.[1].match(/^name:\s*["']?(.+?)["']?\s*$/m)?.[1];
  const heading = content.split('\n').find((line) => line.startsWith('# '));
  return (name ?? heading ?? 'Codex skill').replace(/^#\s+/, '').trim();
}

export function readCodexStatus(): CodexStatus {
  const configPath = join(CODEX_HOME, 'config.toml');
  const config = parseToml(safeRead(configPath));
  const systemSkills = listSkillFiles(join(CODEX_HOME, 'skills')).length;
  const userSkills = listSkillFiles(USER_SKILLS_DIR).length;
  return {
    home: CODEX_HOME,
    exists: existsSync(CODEX_HOME),
    configPath,
    hasGlobalAgents: existsSync(join(CODEX_HOME, 'AGENTS.md')),
    defaultPermissions: config.default_permissions,
    hooksEnabled: boolValue(config['features.codex_hooks']),
    memoriesEnabled: boolValue(config['features.memories']),
    memoryFiles: listMemoryFiles().length,
    userSkills,
    systemSkills,
    rules: countFiles(join(CODEX_HOME, 'rules'), (path) => path.endsWith('.rules') || path.endsWith('.md')),
    sessionFiles: countFiles(join(CODEX_HOME, 'sessions'), (path) => path.endsWith('.jsonl')),
  };
}

export function buildCodexContextBlock(): string {
  const status = readCodexStatus();
  if (!status.exists) return '';
  const budget = readTokenBudget();
  const agents = safeRead(join(CODEX_HOME, 'AGENTS.md'));
  const rules = countFiles(join(CODEX_HOME, 'rules'), (path) => path.endsWith('.rules') || path.endsWith('.md'));
  const skillLines = [
    ...listSkillFiles(USER_SKILLS_DIR).slice(0, 8),
    ...listSkillFiles(join(CODEX_HOME, 'skills')).slice(0, 8),
  ].map((path) => {
    const content = safeRead(path);
    return `- ${basename(dirname(path))}: ${extractDescription(content).slice(0, 180)}`;
  });

  return compactText([
    '# Codex local context',
    `home: ${status.home}`,
    `default permissions: ${status.defaultPermissions ?? 'unset'}`,
    `hooks: ${status.hooksEnabled ? 'on' : 'off'} | memories: ${status.memoriesEnabled ? 'on' : 'off'}`,
    `memory files: ${status.memoryFiles} | rules: ${rules} | sessions: ${status.sessionFiles}`,
    agents && `## global AGENTS.md\n${compactText(redactSecrets(agents), 700, 'tail')}`,
    skillLines.length && `## available Codex skills\n${skillLines.join('\n')}`,
  ].filter(Boolean).join('\n\n'), Math.min(budget.maxSectionTokens, 1500), 'tail');
}

export function importCodexMemory(projectDir: string): { imported: number; path: string } {
  const files = listMemoryFiles().slice(0, 12);
  const path = join(CODEX_HOME, 'memories');
  if (files.length === 0) return { imported: 0, path };
  const budget = readTokenBudget();
  appendAssist(projectDir, 'codex memory imported', files.map((file) =>
    `${basename(file)}\n${compactText(redactSecrets(safeRead(file)), Math.min(600, budget.maxHistoryTokens), 'tail')}`
  ));
  appendHistory(projectDir, {
    kind: 'note',
    title: 'Codex memory imported',
    detail: `Imported ${files.length} memory files from ${path}.`,
    files: files.map((file) => file.replace(`${path}/`, '')),
  });
  return { imported: files.length, path };
}

export function recordCodexHook(projectDir: string, input: CodexHookInput): void {
  const eventName = String(input.hook_event_name || 'unknown');
  const severity = eventName === 'PermissionRequest' || eventName.includes('Failure') ? 'warning' : 'info';
  const payload = summarizeHookInput(input);
  recordEvent(projectDir, {
    type: `codex.${eventName}`,
    severity,
    provenance: { source: 'agent', command: 'codex' },
    payload,
  });
  if (severity !== 'info') {
    appendAssist(projectDir, `codex ${eventName}`, [
      input.cwd ? `cwd: ${input.cwd}` : '',
      input.model ? `model: ${input.model}` : '',
      input.tool_name ? `tool: ${input.tool_name}` : '',
      payload.toolInput ? `input: ${payload.toolInput}` : '',
    ].filter(Boolean));
  }
}

function summarizeHookInput(input: CodexHookInput): Record<string, unknown> {
  const toolInput = input.tool_input === undefined ? '' : compactText(redactSecrets(JSON.stringify(input.tool_input)), 500, 'middle');
  return {
    sessionId: input.session_id,
    transcript: typeof input.transcript_path === 'string' ? basename(input.transcript_path) : undefined,
    cwd: input.cwd,
    event: input.hook_event_name,
    model: input.model,
    toolName: input.tool_name,
    toolInput,
  };
}

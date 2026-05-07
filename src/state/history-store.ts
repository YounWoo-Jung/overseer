import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { compactLines, compactText, readTokenBudget } from '../runtime/token-budget.js';
import { redactSecrets } from '../runtime/redact.js';

const STATE_DIR = '.overseer';
const HISTORY_FILE = 'history.jsonl';
const ASSIST_FILE = 'assist.md';
const PROFILE_FILE = 'project-profile.json';

export type HistoryKind = 'baseline' | 'change' | 'review' | 'skill' | 'trend' | 'note';

export interface HistoryRecord {
  id: string;
  timestamp: string;
  kind: HistoryKind;
  title: string;
  detail: string;
  files?: string[];
}

export interface ProjectProfile {
  projectDir: string;
  updatedAt: string;
  fileCount: number;
  packageName?: string;
  scripts: string[];
  dependencies: string[];
  devDependencies: string[];
  recentFocus: string[];
}

function stateDir(projectDir: string): string {
  return join(resolve(projectDir), STATE_DIR);
}

function ensureState(projectDir: string): void {
  mkdirSync(stateDir(projectDir), { recursive: true });
}

function id(): string {
  return `hist-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function appendHistory(projectDir: string, record: Omit<HistoryRecord, 'id' | 'timestamp'>): HistoryRecord {
  ensureState(projectDir);
  const budget = readTokenBudget();
  const next: HistoryRecord = {
    id: id(),
    timestamp: new Date().toISOString(),
    ...record,
    detail: compactText(redactSecrets(record.detail), budget.maxHistoryTokens, 'middle'),
    files: record.files?.slice(0, 30),
  };
  appendFileSync(join(stateDir(projectDir), HISTORY_FILE), `${JSON.stringify(next)}\n`);
  return next;
}

export function readHistory(projectDir: string, limit = 50): HistoryRecord[] {
  const path = join(stateDir(projectDir), HISTORY_FILE);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf-8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as HistoryRecord;
      } catch {
        return null;
      }
    })
    .filter((record): record is HistoryRecord => Boolean(record))
    .slice(-limit);
}

export function appendAssist(projectDir: string, title: string, lines: string[]): void {
  ensureState(projectDir);
  const budget = readTokenBudget();
  const path = join(stateDir(projectDir), ASSIST_FILE);
  if (!existsSync(path)) writeFileSync(path, '# Overseer Assist\n');
  appendFileSync(path, [
    '',
    `## ${new Date().toISOString()} - ${title}`,
    ...compactLines(lines.map(redactSecrets), budget.maxAssistLineTokens).map((line) => `- ${line}`),
    '',
  ].join('\n'));
}

export function writeProjectProfile(projectDir: string, profile: ProjectProfile): void {
  ensureState(projectDir);
  writeFileSync(join(stateDir(projectDir), PROFILE_FILE), `${JSON.stringify(profile, null, 2)}\n`);
}

export function readProjectProfile(projectDir: string): ProjectProfile | null {
  const path = join(stateDir(projectDir), PROFILE_FILE);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as ProjectProfile;
  } catch {
    return null;
  }
}

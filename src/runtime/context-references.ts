import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';
import type { FileSnapshot } from '../types.js';
import { compactText, estimateTokens, readTokenBudget } from './token-budget.js';
import { resolveProjectPath } from './path-safety.js';
import { snapshotFile } from './file-state.js';

export interface ExpandedContextReferences {
  block: string;
  files: FileSnapshot[];
  warnings: string[];
}

interface ParsedReference {
  raw: string;
  target: string;
  lineStart?: number;
  lineEnd?: number;
}

const REF_RE = /@(?:file:)?([A-Za-z0-9_./-]+(?::\d+(?:-\d+)?)?)/g;
const EXT_RE = /\.(md|txt|json|ts|tsx|js|jsx|css|html|py|go|rs|java|kt|yml|yaml|toml)$/i;

export function expandContextReferences(projectDir: string, text: string): ExpandedContextReferences {
  const refs = parseReferences(text);
  if (refs.length === 0) return { block: '', files: [], warnings: [] };

  const budget = readTokenBudget();
  const maxTokens = Math.max(600, Math.min(budget.maxSectionTokens, Math.floor(budget.maxContextTokens * 0.25)));
  const parts: string[] = [];
  const files: FileSnapshot[] = [];
  const warnings: string[] = [];
  let used = 0;

  for (const ref of refs) {
    const resolved = resolveProjectPath(projectDir, ref.target);
    if (!resolved.success || !resolved.path) {
      warnings.push(`${ref.raw}: ${resolved.message}`);
      continue;
    }
    if (!existsSync(resolved.path)) {
      warnings.push(`${ref.raw}: not found`);
      continue;
    }

    const stat = statSync(resolved.path);
    const rel = relative(resolve(projectDir), resolved.path);
    const content = stat.isDirectory()
      ? listDirectory(resolved.path)
      : readReferencedFile(resolved.path, ref.lineStart, ref.lineEnd);
    const compacted = compactText(content, Math.max(200, maxTokens - used), 'middle');
    const block = `## ${ref.raw} (${rel})\n${compacted}`;
    const tokens = estimateTokens(block);
    if (used + tokens > maxTokens) {
      warnings.push(`${ref.raw}: omitted by context budget`);
      break;
    }
    used += tokens;
    parts.push(block);
    const snapshot = stat.isFile() ? snapshotFile(projectDir, rel) : null;
    if (snapshot) files.push(snapshot);
  }

  return {
    block: parts.length ? `# referenced context\n${parts.join('\n\n')}` : '',
    files,
    warnings,
  };
}

function parseReferences(text: string): ParsedReference[] {
  const refs: ParsedReference[] = [];
  for (const match of text.matchAll(REF_RE)) {
    const raw = match[0];
    const value = match[1];
    const parsed = value.match(/^(.+?)(?::(\d+)(?:-(\d+))?)?$/);
    if (!parsed) continue;
    if (!looksLikePath(parsed[1])) continue;
    refs.push({
      raw,
      target: parsed[1],
      lineStart: parsed[2] ? Number(parsed[2]) : undefined,
      lineEnd: parsed[3] ? Number(parsed[3]) : undefined,
    });
  }
  return dedupe(refs).slice(0, 8);
}

function looksLikePath(value: string): boolean {
  return value.startsWith('./') || value.includes('/') || EXT_RE.test(value);
}

function readReferencedFile(path: string, lineStart?: number, lineEnd?: number): string {
  const raw = readFileSync(path, 'utf-8');
  if (!lineStart) return raw;
  const lines = raw.split('\n');
  const start = Math.max(1, lineStart);
  const end = Math.min(lines.length, lineEnd ?? start + 80);
  return lines.slice(start - 1, end).join('\n');
}

function listDirectory(path: string): string {
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.') && entry.name !== 'node_modules')
    .slice(0, 120)
    .map((entry) => `${entry.isDirectory() ? 'dir ' : 'file'} ${basename(path)}/${entry.name}`)
    .join('\n');
}

function dedupe(refs: ParsedReference[]): ParsedReference[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.target}:${ref.lineStart ?? ''}:${ref.lineEnd ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

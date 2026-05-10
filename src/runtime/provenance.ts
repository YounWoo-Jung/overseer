import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { redactSecrets } from './redact.js';

export type ProvenanceSource = 'cli' | 'tui' | 'tmux' | 'daemon' | 'scheduler' | 'hook' | 'system';

export interface ProvenanceRecord {
  timestamp: string;
  source: ProvenanceSource;
  content: string;
  sessionId?: string;
  paneId?: string;
  command?: string;
}

const STATE_DIR = '.overseer';
const PROVENANCE_FILE = 'provenance.jsonl';

function provenancePath(projectDir: string): string {
  return join(resolve(projectDir), STATE_DIR, PROVENANCE_FILE);
}

export function recordProvenance(projectDir: string, record: Omit<ProvenanceRecord, 'timestamp'>): void {
  mkdirSync(join(resolve(projectDir), STATE_DIR), { recursive: true });
  appendFileSync(provenancePath(projectDir), `${JSON.stringify({
    timestamp: new Date().toISOString(),
    ...record,
    content: redactSecrets(record.content).slice(0, 1000),
  })}\n`);
}

export function readProvenance(projectDir: string, limit = 50): ProvenanceRecord[] {
  const path = provenancePath(projectDir);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf-8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as ProvenanceRecord;
      } catch {
        return null;
      }
    })
    .filter((record): record is ProvenanceRecord => Boolean(record))
    .slice(-limit);
}

export function summarizeProvenance(projectDir: string): Record<ProvenanceSource, number> {
  const summary = Object.fromEntries(['cli', 'tui', 'tmux', 'daemon', 'scheduler', 'hook', 'system'].map((key) => [key, 0])) as Record<ProvenanceSource, number>;
  for (const record of readProvenance(projectDir, 1000)) summary[record.source] += 1;
  return summary;
}

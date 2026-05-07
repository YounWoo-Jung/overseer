import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { redactSecrets } from '../runtime/redact.js';

const STATE_DIR = '.overseer';
const EVENTS_FILE = 'events.jsonl';

export type EventSource = 'tmux' | 'daemon' | 'user' | 'agent' | 'system';

export interface EventProvenance {
  source: EventSource;
  sessionId?: string;
  paneId?: string;
  command?: string;
}

export interface AssistantEventRecord {
  id: string;
  type: string;
  timestamp: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  provenance: EventProvenance;
  payload: Record<string, unknown>;
}

function stateDir(projectDir: string): string {
  return join(resolve(projectDir), STATE_DIR);
}

function eventsPath(projectDir: string): string {
  return join(stateDir(projectDir), EVENTS_FILE);
}

function ensureState(projectDir: string): void {
  mkdirSync(stateDir(projectDir), { recursive: true });
}

function id(): string {
  return `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function recordEvent(projectDir: string, event: Omit<AssistantEventRecord, 'id' | 'timestamp'>): AssistantEventRecord {
  ensureState(projectDir);
  const next: AssistantEventRecord = {
    id: id(),
    timestamp: new Date().toISOString(),
    ...event,
    payload: redactPayload(event.payload),
  };
  appendFileSync(eventsPath(projectDir), `${JSON.stringify(next)}\n`);
  return next;
}

export function readEvents(projectDir: string, limit = 50): AssistantEventRecord[] {
  const path = eventsPath(projectDir);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf-8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as AssistantEventRecord;
      } catch {
        return null;
      }
    })
    .filter((record): record is AssistantEventRecord => Boolean(record))
    .slice(-limit);
}

function redactPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(redactSecrets(JSON.stringify(payload))) as Record<string, unknown>;
}

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunRecord, RunResult } from '../types.js';

const STATE_DIR = '.overseer';
const RUNS_FILE = 'runs.jsonl';

function stateDir(projectDir: string): string {
  return join(projectDir, STATE_DIR);
}

function runsPath(projectDir: string): string {
  return join(stateDir(projectDir), RUNS_FILE);
}

function ensureState(projectDir: string): void {
  mkdirSync(stateDir(projectDir), { recursive: true });
  if (!existsSync(runsPath(projectDir))) writeFileSync(runsPath(projectDir), '');
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9가-힣_./-]+/i)
      .map((word) => word.trim())
      .filter((word) => word.length >= 2)
  );
}

function scoreTask(query: string, record: RunRecord): number {
  const q = tokenize(query);
  const target = tokenize(`${record.task} ${record.planSummary} ${record.validation.errors.join(' ')}`);
  let score = 0;
  for (const item of q) {
    if (target.has(item)) score += 1;
  }
  if (!record.success) score += 0.5;
  return score;
}

export function toRunRecord(result: RunResult): RunRecord {
  return {
    id: `run-${Date.now().toString(36)}`,
    timestamp: new Date().toISOString(),
    task: result.task,
    success: result.success,
    iterations: result.iterations,
    planSummary: result.plan.summary,
    validation: {
      success: result.validation.success,
      commands: result.validation.checks.map((check) => check.command),
      errors: result.validation.checks.flatMap((check) => check.errors).slice(-30),
    },
    review: result.review.slice(0, 2000),
    skillsUsed: result.skillsUsed,
  };
}

export function appendRunRecord(projectDir: string, result: RunResult): RunRecord {
  ensureState(projectDir);
  const record = toRunRecord(result);
  appendFileSync(runsPath(projectDir), `${JSON.stringify(record)}\n`);
  return record;
}

export function readRunRecords(projectDir: string): RunRecord[] {
  ensureState(projectDir);
  return readFileSync(runsPath(projectDir), 'utf-8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as RunRecord;
      } catch {
        return null;
      }
    })
    .filter((record): record is RunRecord => Boolean(record));
}

export function findRelatedRuns(projectDir: string, task: string, limit = 5): RunRecord[] {
  return readRunRecords(projectDir)
    .map((record) => ({ record, score: scoreTask(task, record) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.record);
}

export function buildLearningContext(projectDir: string, task: string): string {
  const related = findRelatedRuns(projectDir, task, 5);
  const recentFailures = readRunRecords(projectDir)
    .filter((record) => !record.success)
    .slice(-5);

  const relatedText = related.map((record) => [
    `- ${record.timestamp} | ${record.success ? 'success' : 'failed'} | ${record.task}`,
    `  plan: ${record.planSummary}`,
    record.validation.errors.length ? `  errors: ${record.validation.errors.slice(-3).join(' / ')}` : '',
  ].filter(Boolean).join('\n')).join('\n');

  const failureText = recentFailures.map((record) => [
    `- ${record.task}`,
    record.validation.errors.length ? `  prevention: check ${record.validation.commands.join(', ')} output first` : '',
  ].filter(Boolean).join('\n')).join('\n');

  return [
    relatedText && `# related past runs\n${relatedText}`,
    failureText && `# recent failure patterns\n${failureText}`,
  ].filter(Boolean).join('\n\n');
}

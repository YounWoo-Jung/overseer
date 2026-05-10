import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunResult } from '../types.js';
import { writeCompletionArtifacts } from '../runtime/completion.js';
import { appendRunRecord } from './learning-store.js';
import { evolveSkills } from './skill-evolver.js';
import { updateSkillStats } from './skill-stats.js';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function ensureFile(path: string, initial: string): void {
  if (!existsSync(path)) writeFileSync(path, initial);
}

export function recordLearning(projectDir: string, result: RunResult): void {
  const summaryPath = join(projectDir, 'SUMMARY.md');
  const memoryPath = join(projectDir, 'MEMORY.md');
  const mistakePath = join(projectDir, 'MISTAKE.md');
  const verdict = writeCompletionArtifacts(projectDir, result);

  ensureFile(summaryPath, '');
  appendFileSync(summaryPath, [
    '',
    `# AI Work Summary (${today()})`,
    '## What was done',
    `- Task: ${result.task}`,
    `- Result: ${result.success ? 'success' : 'failed'}`,
    '## Files',
    '- See git diff for changed files.',
    '## Notes',
    `- Iterations: ${result.iterations}`,
    `- Completion: ${verdict.summary}`,
    '',
  ].join('\n'));

  const memory = existsSync(memoryPath) ? readFileSync(memoryPath, 'utf-8') : '';
  const reviewRules = extractReviewRules(result.review);
  const nextMemory = [
    '# MEMORY.md',
    '',
    `Latest task: ${result.task}`,
    `Latest result: ${result.success ? 'success' : 'failed'}`,
    `Latest updated: ${new Date().toISOString()}`,
    reviewRules.length ? '\n## Learned Review Rules' : '',
    ...reviewRules.map((rule) => `- ${rule}`),
  ].join('\n');
  if (!memory.includes(`Latest task: ${result.task}`)) {
    writeFileSync(memoryPath, nextMemory + '\n');
  }

  const record = appendRunRecord(projectDir, result);
  updateSkillStats(projectDir, record);
  evolveSkills(projectDir, record);

  if (!result.success) {
    ensureFile(mistakePath, '# MISTAKE.md\n');
    appendFileSync(mistakePath, [
      '',
      `## ${today()} - ${result.task}`,
      '- Cause: validation did not pass within the iteration limit.',
      '- Prevention: inspect failing command output before applying the next patch.',
      '',
    ].join('\n'));
  }
}

function extractReviewRules(review: string): string[] {
  return review
    .split('\n')
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter((line) => /validation|test|repeat|rule|caution|missing|failure|refactor|type|build/i.test(line))
    .map((line) => line.slice(0, 180))
    .filter(Boolean)
    .slice(0, 5);
}

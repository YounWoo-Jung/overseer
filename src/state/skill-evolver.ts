import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { RunRecord } from '../types.js';
import { isSkillDisabled } from './skill-stats.js';

function slugTask(task: string): string {
  const slug = task
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return slug || 'general_dev';
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function skillPath(projectDir: string, record: RunRecord): string {
  const name = record.success ? `auto_${slugTask(record.task)}.md` : 'auto_failure_recovery.md';
  return join(projectDir, 'skills', name);
}

function ensureSkillFile(path: string, title: string): void {
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) {
    writeFileSync(path, [
      `# ${title}`,
      '',
      '## When to use',
      '- Similar development tasks appear again.',
      '',
      '## Procedure',
      '- Read project instructions first.',
      '- Prefer minimal diffs.',
      '- Run detected validation commands.',
      '',
      '## Learned cases',
      '',
    ].join('\n'));
  }
}

export function evolveSkills(projectDir: string, record: RunRecord): void {
  const path = skillPath(projectDir, record);
  const name = path.split('/').at(-1) ?? '';
  if (name && isSkillDisabled(projectDir, name)) return;
  ensureSkillFile(path, record.success ? `Auto Skill: ${record.task}` : 'Auto Skill: Failure Recovery');
  const existing = readFileSync(path, 'utf-8');
  if (existing.includes(record.id) || existing.includes(`Task: ${record.task}`)) return;

  const errors = record.validation.errors.slice(-5);
  appendFileSync(path, [
    '',
    `### ${today()} ${record.success ? 'success' : 'failure'} (${record.id})`,
    `- Task: ${record.task}`,
    `- Plan: ${record.planSummary}`,
    `- Validation: ${record.validation.success ? 'passed' : 'failed'}`,
    errors.length ? `- Errors: ${errors.join(' / ')}` : '',
    record.success
      ? '- Reuse: apply the same small-plan, validate, review flow for similar work.'
      : '- Prevention: inspect failing command output before generating the next fix.',
    '',
  ].filter(Boolean).join('\n'));
}

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { RunResult, ValidationResult } from '../types.js';

export interface DoneCheck {
  name: string;
  category: 'files' | 'build' | 'test' | 'quality';
  passed: boolean;
  required: boolean;
  message: string;
}

export interface DoneVerdict {
  done: boolean;
  score: number;
  checks: DoneCheck[];
  requiredPassed: number;
  requiredTotal: number;
  summary: string;
}

export interface AcceptanceCriterion {
  id: string;
  priority: 'high' | 'medium' | 'low';
  source: string;
  description: string;
}

const STATE_DIR = '.overseer';
const REPORT_FILE = 'completion-report.md';
const AC_FILE = 'acceptance-criteria.json';

export function evaluateDone(projectDir: string, validation?: ValidationResult): DoneVerdict {
  const root = resolve(projectDir);
  const checks: DoneCheck[] = [];
  const srcCount = countFiles(root, /\.(ts|tsx|js|jsx)$/);
  const hasTests = countFiles(root, /\.(test|spec)\.(ts|tsx|js|jsx)$/) > 0;
  const validationSuccess = validation?.success ?? false;

  checks.push({ name: 'package.json', category: 'files', passed: existsSync(join(root, 'package.json')), required: true, message: 'package.json exists' });
  checks.push({ name: 'source-files', category: 'files', passed: srcCount > 0, required: true, message: `source files: ${srcCount}` });
  checks.push({ name: 'validation', category: 'build', passed: validationSuccess, required: true, message: validation ? `${validation.checks.filter((check) => check.success).length}/${validation.checks.length} checks passed` : 'not validated' });
  checks.push({ name: 'readme', category: 'files', passed: existsSync(join(root, 'README.md')), required: false, message: 'README.md exists' });
  checks.push({ name: 'tests', category: 'test', passed: hasTests, required: false, message: hasTests ? 'test files exist' : 'no test files' });
  checks.push({ name: 'state-files', category: 'quality', passed: ['MEMORY.md', 'SUMMARY.md', 'MISTAKE.md'].every((name) => existsSync(join(root, name))), required: false, message: 'agent state files' });

  const passed = checks.filter((check) => check.passed).length;
  const required = checks.filter((check) => check.required);
  const requiredPassed = required.filter((check) => check.passed).length;
  const score = Math.round((passed / checks.length) * 100);
  const done = requiredPassed === required.length;
  const summary = `${done ? 'done' : 'not done'} (${score}/100, required ${requiredPassed}/${required.length})`;
  return { done, score, checks, requiredPassed, requiredTotal: required.length, summary };
}

export function buildAcceptanceCriteria(result: RunResult, verdict: DoneVerdict): AcceptanceCriterion[] {
  const items: AcceptanceCriterion[] = [];
  for (const check of verdict.checks.filter((item) => item.required && !item.passed)) {
    items.push({
      id: `done:${check.name}`,
      priority: 'high',
      source: 'done',
      description: `${check.name}: ${check.message}`,
    });
  }
  for (const check of result.validation.checks.filter((item) => !item.success).slice(0, 5)) {
    items.push({
      id: `validation:${check.name}`,
      priority: 'high',
      source: 'validation',
      description: `${check.command} must pass`,
    });
  }
  for (const risk of result.plan.risks.slice(0, 5)) {
    items.push({
      id: `risk:${risk}`.slice(0, 80),
      priority: 'medium',
      source: 'plan',
      description: risk,
    });
  }
  return dedupe(items).slice(0, 20);
}

export function writeCompletionArtifacts(projectDir: string, result: RunResult): DoneVerdict {
  const root = resolve(projectDir);
  const state = join(root, STATE_DIR);
  mkdirSync(state, { recursive: true });
  const verdict = evaluateDone(root, result.validation);
  const ac = buildAcceptanceCriteria(result, verdict);
  writeFileSync(join(state, REPORT_FILE), formatDoneReport(verdict));
  writeFileSync(join(state, AC_FILE), `${JSON.stringify(ac, null, 2)}\n`);
  return verdict;
}

export function readDoneReport(projectDir: string): string {
  const path = join(resolve(projectDir), STATE_DIR, REPORT_FILE);
  return existsSync(path) ? readFileSync(path, 'utf-8') : '';
}

export function formatDoneReport(verdict: DoneVerdict): string {
  const lines = [
    '# Completion Report',
    '',
    `## ${verdict.summary}`,
    '',
    '| Category | Check | Required | Status |',
    '|---|---|---|---|',
  ];
  for (const check of verdict.checks) {
    lines.push(`| ${check.category} | ${check.name} | ${check.required ? 'yes' : 'no'} | ${check.passed ? 'pass' : 'fail'} - ${check.message} |`);
  }
  lines.push('');
  return lines.join('\n');
}

function countFiles(dir: string, pattern: RegExp, depth = 0): number {
  if (depth > 5 || !existsSync(dir)) return 0;
  let count = 0;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === '.overseer' || name === 'dist') continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) count += countFiles(path, pattern, depth + 1);
    else if (pattern.test(name)) count += 1;
  }
  return count;
}

function dedupe(items: AcceptanceCriterion[]): AcceptanceCriterion[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.description.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

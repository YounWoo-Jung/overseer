import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunRecord, SkillStat } from '../types.js';

const STATE_DIR = '.overseer';
const STATS_FILE = 'skill-stats.json';

function statsPath(projectDir: string): string {
  return join(projectDir, STATE_DIR, STATS_FILE);
}

function ensureState(projectDir: string): void {
  mkdirSync(join(projectDir, STATE_DIR), { recursive: true });
  if (!existsSync(statsPath(projectDir))) writeFileSync(statsPath(projectDir), '{}');
}

function emptyStat(name: string): SkillStat {
  return {
    name,
    runs: 0,
    successes: 0,
    failures: 0,
    score: 0,
    disabled: false,
    updatedAt: new Date().toISOString(),
  };
}

export function readSkillStats(projectDir: string): Record<string, SkillStat> {
  ensureState(projectDir);
  try {
    const parsed = JSON.parse(readFileSync(statsPath(projectDir), 'utf-8')) as Record<string, SkillStat>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writeSkillStats(projectDir: string, stats: Record<string, SkillStat>): void {
  ensureState(projectDir);
  writeFileSync(statsPath(projectDir), `${JSON.stringify(stats, null, 2)}\n`);
}

export function isSkillDisabled(projectDir: string, name: string): boolean {
  return Boolean(readSkillStats(projectDir)[name]?.disabled);
}

export function updateSkillStats(projectDir: string, record: RunRecord): void {
  const stats = readSkillStats(projectDir);
  for (const name of record.skillsUsed) {
    const stat = stats[name] ?? emptyStat(name);
    stat.runs += 1;
    if (record.success) stat.successes += 1;
    else stat.failures += 1;
    stat.score = stat.runs > 0 ? stat.successes / stat.runs : 0;
    stat.updatedAt = new Date().toISOString();
    if (stat.failures >= 3) {
      stat.disabled = true;
      stat.disabledReason = 'disabled after 3 failed runs using this skill';
    }
    stats[name] = stat;
  }
  writeSkillStats(projectDir, stats);
}

export function getRankedSkillStats(projectDir: string): SkillStat[] {
  return Object.values(readSkillStats(projectDir))
    .sort((a, b) => Number(a.disabled) - Number(b.disabled) || b.score - a.score || b.runs - a.runs);
}

export function buildSkillStatsContext(projectDir: string): string {
  const ranked = getRankedSkillStats(projectDir);
  const enabled = ranked.filter((stat) => !stat.disabled).slice(0, 5);
  const disabled = ranked.filter((stat) => stat.disabled).slice(0, 5);

  return [
    enabled.length && `# high value skills\n${enabled.map((s) => `- ${s.name}: score=${s.score.toFixed(2)}, runs=${s.runs}`).join('\n')}`,
    disabled.length && `# disabled skills\n${disabled.map((s) => `- ${s.name}: ${s.disabledReason ?? 'disabled'}`).join('\n')}`,
  ].filter(Boolean).join('\n\n');
}

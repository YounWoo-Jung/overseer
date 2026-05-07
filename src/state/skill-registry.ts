import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { compactText, estimateTokens, readTokenBudget } from '../runtime/token-budget.js';
import { readSkillStats } from './skill-stats.js';

export interface SkillIndexEntry {
  name: string;
  fileName: string;
  path: string;
  description: string;
  disabled: boolean;
  loaded: boolean;
  score: number;
  bodyTokens: number;
}

export interface LoadedSkill {
  name: string;
  content: string;
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'not', 'you', 'all', 'can', 'are', 'has', 'have',
  'from', 'this', 'that', 'with', 'will', 'when', 'use', 'how', 'which',
  'their', 'what',
]);

export function indexSkills(projectDir: string): SkillIndexEntry[] {
  const root = resolve(projectDir);
  const skillsDir = join(root, 'skills');
  const stats = readSkillStats(root);
  if (!existsSync(skillsDir)) return [];

  return readdirSync(skillsDir)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((fileName) => {
      const path = join(skillsDir, fileName);
      const raw = readFileSync(path, 'utf-8');
      const name = basename(fileName, '.md');
      const stat = stats[fileName] ?? stats[name];
      return {
        name,
        fileName,
        path,
        description: extractDescription(raw),
        disabled: Boolean(stat?.disabled),
        loaded: false,
        score: stat?.score ?? 0,
        bodyTokens: estimateTokens(raw),
      };
    })
    .filter((skill) => !skill.disabled)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

export function buildAvailableSkillsBlock(projectDir: string, context: string): string {
  const budget = readTokenBudget();
  const skills = indexSkills(projectDir);
  if (skills.length === 0) return '';
  const matched = autoMatchSkills(projectDir, context, 8);
  const matchedNames = new Set(matched.map((skill) => skill.name));
  const lines = ['<available_skills>'];
  for (const skill of skills.slice(0, 30)) {
    const marker = matchedNames.has(skill.name) ? ' matched="true"' : '';
    const line = `  <skill${marker}><name>${escapeXml(skill.name)}</name><description>${escapeXml(skill.description)}</description><tokens>${skill.bodyTokens}</tokens><path>${escapeXml(skill.path)}</path></skill>`;
    if (estimateTokens(lines.join('\n') + line) > budget.maxSectionTokens) {
      lines.push('  <!-- omitted by skill L1 budget -->');
      break;
    }
    lines.push(line);
  }
  lines.push('</available_skills>');
  return lines.join('\n');
}

export function autoMatchSkills(projectDir: string, context: string, limit = 5): SkillIndexEntry[] {
  const skills = indexSkills(projectDir);
  if (skills.length === 0) return [];
  const contextTokens = tokenize(context);
  if (contextTokens.length === 0) return [];
  const docFreq = new Map<string, number>();
  for (const skill of skills) {
    const seen = new Set(tokenize(`${skill.name} ${skill.description}`));
    for (const token of seen) docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
  }

  const scored = skills.map((skill) => {
    const tokens = tokenize(`${skill.name} ${skill.description}`);
    let score = skill.score * 0.25;
    for (const token of tokens) {
      if (!contextTokens.includes(token)) continue;
      const idf = Math.log(skills.length / (docFreq.get(token) || 1)) + 1;
      score += idf / Math.max(1, tokens.length);
    }
    return { skill, score };
  });

  return scored
    .filter((item) => item.score >= 0.1)
    .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
    .slice(0, limit)
    .map((item) => item.skill);
}

export function loadMatchedSkills(projectDir: string, context: string, limit = 5): LoadedSkill[] {
  const budget = readTokenBudget();
  const maxTotalTokens = Math.max(budget.maxSectionTokens, budget.maxSectionTokens * 2);
  const matched = autoMatchSkills(projectDir, context, limit);
  const loaded: LoadedSkill[] = [];
  let usedTokens = 0;
  for (const skill of matched) {
    const raw = readFileSync(skill.path, 'utf-8');
    const content = compactText(raw, budget.maxSectionTokens, 'tail');
    const tokens = estimateTokens(content);
    if (usedTokens + tokens > maxTotalTokens) break;
    loaded.push({ name: skill.fileName, content });
    usedTokens += tokens;
  }
  return loaded;
}

export function ensureSkillsDir(projectDir: string): void {
  mkdirSync(join(resolve(projectDir), 'skills'), { recursive: true });
}

function extractDescription(content: string): string {
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
  if (frontmatter) {
    const desc = frontmatter[1].match(/^description:\s*["']?(.+?)["']?\s*$/m);
    if (desc?.[1]) return desc[1].trim().slice(0, 240);
  }
  const heading = content.split('\n').find((line) => line.startsWith('# '));
  const bullet = content.split('\n').find((line) => /^[-*]\s+/.test(line.trim()));
  return (bullet ?? heading ?? 'Project assistant skill').replace(/^[-*#\s]+/, '').trim().slice(0, 240);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9가-힣_.-]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildLearningContext } from '../state/learning-store.js';
import { buildAvailableSkillsBlock, loadMatchedSkills } from '../state/skill-registry.js';
import { buildSkillStatsContext } from '../state/skill-stats.js';
import type { ProjectContext } from '../types.js';
import { buildClaudeCodeContextBlock } from './claude-code.js';
import { buildCodexContextBlock } from './codex-context.js';
import { compactText, readTokenBudget } from './token-budget.js';

function readOptional(path: string): string {
  if (!existsSync(path)) return '';
  return readFileSync(path, 'utf-8');
}

export function loadProjectContext(projectDir: string, task = ''): ProjectContext {
  const root = resolve(projectDir);
  const instructions = readOptional(join(root, 'AGENTS.md'));
  const memory = readOptional(join(root, 'MEMORY.md'));
  const summary = readOptional(join(root, 'SUMMARY.md'));
  const mistakes = readOptional(join(root, 'MISTAKE.md'));
  const matchContext = [task, memory, summary, mistakes].filter(Boolean).join('\n\n');
  const availableSkills = buildAvailableSkillsBlock(root, matchContext);

  return {
    projectDir: root,
    instructions,
    memory,
    summary,
    mistakes,
    learning: [
      task ? buildLearningContext(root, task) : '',
      buildSkillStatsContext(root),
      availableSkills,
      buildClaudeCodeContextBlock(root, matchContext),
      buildCodexContextBlock(),
    ].filter(Boolean).join('\n\n'),
    skills: loadMatchedSkills(root, matchContext),
  };
}

export function formatContext(ctx: ProjectContext): string {
  const budget = readTokenBudget();
  const skillText = ctx.skills
    .slice(0, 8)
    .map((skill) => `## skill:${skill.name}\n${compactText(skill.content, budget.maxSectionTokens, 'tail')}`)
    .join('\n\n');

  const full = [
    `# project\n${ctx.projectDir}`,
    ctx.instructions && `# AGENTS.md\n${compactText(ctx.instructions, budget.maxSectionTokens, 'middle')}`,
    ctx.memory && `# MEMORY.md\n${compactText(ctx.memory, budget.maxSectionTokens, 'tail')}`,
    ctx.summary && `# SUMMARY.md\n${compactText(ctx.summary, budget.maxSectionTokens, 'tail')}`,
    ctx.mistakes && `# MISTAKE.md\n${compactText(ctx.mistakes, budget.maxSectionTokens, 'tail')}`,
    ctx.learning && `# learned run patterns\n${compactText(ctx.learning, budget.maxSectionTokens, 'tail')}`,
    skillText && `# skills\n${skillText}`,
  ].filter(Boolean).join('\n\n');
  return compactText(full, budget.maxContextTokens, 'tail');
}

import { askLlm } from '../llm/provider.js';
import { formatContext } from '../runtime/context.js';
import type { ProjectContext, ValidationResult } from '../types.js';
import { gitDiff } from '../tools/git.js';

export function reviewResult(task: string, ctx: ProjectContext, validation: ValidationResult): string {
  const diff = gitDiff(ctx.projectDir);
  if (!diff.trim()) return 'No code changes detected.';

  const response = askLlm({
    system: 'You are a strict code reviewer. Be brief. Focus on bugs and missing tests.',
    prompt: [
      formatContext(ctx),
      '# task',
      task,
      '# validation',
      JSON.stringify(validation, null, 2).slice(-8000),
      '# diff',
      diff.slice(-12000),
      'Return a concise review in Korean.',
    ].join('\n\n'),
  });

  return response || 'Review skipped because no LLM provider is available.';
}

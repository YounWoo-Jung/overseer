import { askLlm } from '../llm/provider.js';
import { formatContext } from '../runtime/context.js';
import type { PatchResult, ProjectContext, ValidationResult } from '../types.js';
import { gitDiff } from '../tools/git.js';

function extractDiff(text: string): string {
  const fenced = text.match(/```(?:diff|patch)?\s*([\s\S]*?)```/);
  const body = fenced?.[1] ?? text;
  const start = body.search(/^diff --git |^--- /m);
  return start >= 0 ? body.slice(start).trim() : '';
}

export function fixFailure(task: string, ctx: ProjectContext, validation: ValidationResult): PatchResult {
  const response = askLlm({
    system: 'You are a debugger. Fix only the validation failure. Return one minimal unified git diff only.',
    prompt: [
      formatContext(ctx),
      '# task',
      task,
      '# failing validation',
      JSON.stringify(validation.checks.filter((check) => !check.success), null, 2).slice(-10000),
      '# current diff',
      gitDiff(ctx.projectDir).slice(-6000),
      'Return only a unified diff that can be applied with git apply.',
    ].join('\n\n'),
  });

  const diff = extractDiff(response);
  return { summary: diff ? 'fix proposed' : 'no fix proposed', diff };
}

import { askLlm } from '../llm/provider.js';
import { formatContext } from '../runtime/context.js';
import type { PatchResult, PlanResult, ProjectContext } from '../types.js';
import { gitDiff } from '../tools/git.js';
import { listProjectFiles } from '../tools/search.js';

function extractDiff(text: string): string {
  const fenced = text.match(/```(?:diff|patch)?\s*([\s\S]*?)```/);
  const body = fenced?.[1] ?? text;
  const start = body.search(/^diff --git |^\*\*\* Begin Patch|^--- /m);
  return start >= 0 ? body.slice(start).trim() : '';
}

export function implementTask(task: string, ctx: ProjectContext, plan: PlanResult): PatchResult {
  const response = askLlm({
    system: 'You are a development worker. Produce one minimal unified git diff only. Do not rewrite unrelated files.',
    prompt: [
      formatContext(ctx),
      '# files',
      listProjectFiles(ctx.projectDir),
      '# current diff',
      gitDiff(ctx.projectDir).slice(-6000),
      '# task',
      task,
      '# plan',
      JSON.stringify(plan),
      'Return only a unified diff that can be applied with git apply.',
    ].join('\n\n'),
  });

  const diff = extractDiff(response);
  return { summary: diff ? 'patch proposed' : 'no patch proposed', diff };
}

import { askLlm } from '../llm/provider.js';
import type { PlanResult, ProjectContext } from '../types.js';
import { formatContext } from '../runtime/context.js';
import { listProjectFiles } from '../tools/search.js';

export function planTask(task: string, ctx: ProjectContext): PlanResult {
  const response = askLlm({
    system: 'You are a senior development-agent planner. Return compact JSON only.',
    prompt: [
      formatContext(ctx),
      '# files',
      listProjectFiles(ctx.projectDir),
      '# task',
      task,
      'Return JSON: {"summary": string, "steps": string[], "risks": string[]}.',
    ].join('\n\n'),
  });

  if (!response) {
    return {
      summary: task,
      steps: ['Inspect project context', 'Apply the smallest useful change', 'Run validation', 'Record learning'],
      risks: ['No LLM provider found; running fallback plan'],
    };
  }

  try {
    const parsed = JSON.parse(response.replace(/^```json\s*|\s*```$/g, '')) as PlanResult;
    return {
      summary: parsed.summary || task,
      steps: Array.isArray(parsed.steps) ? parsed.steps : [],
      risks: Array.isArray(parsed.risks) ? parsed.risks : [],
    };
  } catch {
    return { summary: response.slice(0, 500), steps: [task], risks: ['Planner JSON parse failed'] };
  }
}

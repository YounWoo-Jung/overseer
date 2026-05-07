import { fixFailure } from './agents/debugger.js';
import { implementTask } from './agents/worker.js';
import { planTask } from './agents/planner.js';
import { reviewResult } from './agents/reviewer.js';
import { loadProjectContext } from './runtime/context.js';
import { validateProject } from './runtime/validator.js';
import { recordLearning } from './state/knowledge.js';
import { applyUnifiedDiff } from './tools/git.js';
import { registerBuiltinTools } from './tools/index.js';
import type { AgentEvent, RunInput, RunResult } from './types.js';

function makeEvent(phase: AgentEvent['phase'], message: string, success?: boolean, detail?: string): AgentEvent {
  return { phase, message, success, detail, timestamp: new Date().toISOString() };
}

export async function runAutonomousTask(input: RunInput): Promise<RunResult> {
  registerBuiltinTools();
  const events: AgentEvent[] = [];
  const emit = (event: AgentEvent) => {
    events.push(event);
    input.onEvent?.(event);
  };

  const maxIterations = input.maxIterations ?? 3;
  emit(makeEvent('context', 'project context loaded'));
  let ctx = loadProjectContext(input.projectDir, input.task);

  emit(makeEvent('plan', 'planning task'));
  const plan = planTask(input.task, ctx);

  emit(makeEvent('implement', plan.summary));
  const patch = implementTask(input.task, ctx, plan);
  if (patch.diff) {
    const applied = applyUnifiedDiff(input.projectDir, patch.diff);
    emit(makeEvent('implement', applied.success ? 'patch applied' : 'patch failed', applied.success, applied.output));
  } else {
    emit(makeEvent('implement', 'no patch generated', false));
  }

  let validation = validateProject(input.projectDir);
  emit(makeEvent('validate', validation.success ? 'validation passed' : 'validation failed', validation.success));

  let iterations = 1;
  while (!validation.success && iterations < maxIterations) {
    iterations += 1;
    ctx = loadProjectContext(input.projectDir, input.task);
    emit(makeEvent('debug', `fix iteration ${iterations}`));
    const fix = fixFailure(input.task, ctx, validation);
    if (!fix.diff) {
      emit(makeEvent('debug', 'no fix generated', false));
      break;
    }
    const applied = applyUnifiedDiff(input.projectDir, fix.diff);
    emit(makeEvent('debug', applied.success ? 'fix applied' : 'fix failed', applied.success, applied.output));
    if (!applied.success) break;
    validation = validateProject(input.projectDir);
    emit(makeEvent('validate', validation.success ? 'validation passed' : 'validation failed', validation.success));
  }

  ctx = loadProjectContext(input.projectDir, input.task);
  emit(makeEvent('review', 'reviewing result'));
  const review = reviewResult(input.task, ctx, validation);

  const result: RunResult = {
    success: validation.success,
    task: input.task,
    projectDir: input.projectDir,
    iterations,
    plan,
    validation,
    review,
    events,
    skillsUsed: ctx.skills.map((skill) => skill.name),
  };

  emit(makeEvent('learn', 'recording summary and memory'));
  recordLearning(input.projectDir, result);
  emit(makeEvent('done', validation.success ? 'done' : 'failed', validation.success));
  return result;
}

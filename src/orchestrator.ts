import { fixFailure } from './agents/debugger.js';
import { implementTask } from './agents/worker.js';
import { planTask } from './agents/planner.js';
import { reviewResult } from './agents/reviewer.js';
import { loadProjectContext } from './runtime/context.js';
import { validateProject } from './runtime/validator.js';
import { createCheckpoint } from './runtime/checkpoint.js';
import { verifyPatchDiff } from './runtime/diff-verifier.js';
import { checkStaleWrites } from './runtime/file-state.js';
import { runShellHook } from './runtime/shell-hooks.js';
import { recordLearning } from './state/knowledge.js';
import { applyUnifiedDiff } from './tools/git.js';
import { registerBuiltinTools } from './tools/index.js';
import type { AgentEvent, FileSnapshot, RunInput, RunResult } from './types.js';

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
    const checkpoint = createCheckpoint(input.projectDir, `before implement: ${input.task}`);
    emit(makeEvent('implement', checkpoint.success ? `checkpoint ${checkpoint.id}` : 'checkpoint skipped', checkpoint.success, checkpoint.message));
    const applied = applyPatchWithGuards(input.projectDir, input.task, patch.diff, ctx.referencedFiles);
    emit(makeEvent('implement', applied.success ? 'patch applied' : 'patch failed', applied.success, applied.output));
  } else {
    emit(makeEvent('implement', 'no patch generated', false));
  }

  let validation = validateProject(input.projectDir);
  emit(makeEvent('validate', validation.success ? 'validation passed' : 'validation failed', validation.success));
  if (!validation.success) runShellHook(input.projectDir, 'validation-failed', { task: input.task, checks: validation.checks });

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
    const checkpoint = createCheckpoint(input.projectDir, `before fix ${iterations}: ${input.task}`);
    emit(makeEvent('debug', checkpoint.success ? `checkpoint ${checkpoint.id}` : 'checkpoint skipped', checkpoint.success, checkpoint.message));
    const applied = applyPatchWithGuards(input.projectDir, input.task, fix.diff, ctx.referencedFiles);
    emit(makeEvent('debug', applied.success ? 'fix applied' : 'fix failed', applied.success, applied.output));
    if (!applied.success) break;
    validation = validateProject(input.projectDir);
    emit(makeEvent('validate', validation.success ? 'validation passed' : 'validation failed', validation.success));
    if (!validation.success) runShellHook(input.projectDir, 'validation-failed', { task: input.task, checks: validation.checks });
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
  runShellHook(input.projectDir, 'run-done', { task: input.task, success: result.success, iterations: result.iterations });
  emit(makeEvent('done', validation.success ? 'done' : 'failed', validation.success));
  return result;
}

function applyPatchWithGuards(projectDir: string, task: string, diff: string, referencedFiles?: FileSnapshot[]): { success: boolean; output: string } {
  const verification = verifyPatchDiff(projectDir, diff, referencedFiles);
  if (!verification.passed) return { success: false, output: verification.errors.join('\n') };
  const stale = checkStaleWrites(projectDir, referencedFiles, diff);
  if (stale.length > 0) return { success: false, output: `stale write blocked: ${stale.map((item) => item.path).join(', ')}` };

  const beforeHook = runShellHook(projectDir, 'before-patch', { task, touchedFiles: verification.touchedFiles, warnings: verification.warnings });
  if (beforeHook.ran && !beforeHook.success) return { success: false, output: `before-patch hook failed: ${beforeHook.output}` };

  const applied = applyUnifiedDiff(projectDir, diff);
  runShellHook(projectDir, 'after-patch', { task, success: applied.success, touchedFiles: verification.touchedFiles, output: applied.output });
  return {
    success: applied.success,
    output: [verification.warnings.join('\n'), applied.output].filter(Boolean).join('\n'),
  };
}

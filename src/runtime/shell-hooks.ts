import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { recordEvent } from '../state/event-store.js';
import { redactSecrets } from './redact.js';

export type ShellHookEvent = 'before-patch' | 'after-patch' | 'validation-failed' | 'run-done';

export interface ShellHookResult {
  ran: boolean;
  success: boolean;
  output: string;
}

export function runShellHook(projectDir: string, event: ShellHookEvent, payload: Record<string, unknown>): ShellHookResult {
  const script = join(resolve(projectDir), '.overseer', 'hooks', `${event}.sh`);
  if (!existsSync(script)) return { ran: false, success: true, output: '' };
  const stat = statSync(script);
  if ((stat.mode & 0o111) === 0) {
    return { ran: false, success: false, output: `${script} is not executable` };
  }
  const result = spawnSync(script, {
    cwd: resolve(projectDir),
    input: `${JSON.stringify(payload)}\n`,
    encoding: 'utf-8',
    timeout: 60_000,
    maxBuffer: 1024 * 1024,
    shell: false,
  });
  const output = redactSecrets(`${result.stdout ?? ''}${result.stderr ?? ''}`.trim()).slice(-4000);
  const hookResult = { ran: true, success: result.status === 0, output };
  recordEvent(projectDir, {
    type: `hook.${event}`,
    severity: hookResult.success ? 'info' : 'warning',
    provenance: { source: 'system', command: script },
    payload: { status: result.status, output },
  });
  return hookResult;
}

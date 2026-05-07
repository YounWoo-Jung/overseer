import { execFileSync, spawnSync } from 'node:child_process';
import { compactText, readTokenBudget } from '../runtime/token-budget.js';

export interface LlmRequest {
  system: string;
  prompt: string;
}

function hasCommand(command: string): boolean {
  try {
    execFileSync('which', [command], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function availableProvider(): 'codex' | 'claude' | 'none' {
  if (hasCommand('codex')) return 'codex';
  if (hasCommand('claude')) return 'claude';
  return 'none';
}

export function askLlm(req: LlmRequest): string {
  const provider = availableProvider();
  const budget = readTokenBudget();
  const system = compactText(req.system, Math.floor(budget.maxPromptTokens * 0.25), 'middle');
  const prompt = compactText(req.prompt, Math.floor(budget.maxPromptTokens * 0.75), 'tail');
  const input = compactText(`[System]\n${system}\n\n[User]\n${prompt}`, budget.maxPromptTokens, 'tail');

  if (provider === 'codex') {
    const out = spawnSync('codex', ['exec', '--ephemeral', '--skip-git-repo-check', '-'], {
      input,
      encoding: 'utf-8',
      maxBuffer: 8 * 1024 * 1024,
      timeout: 180_000,
    });
    if (out.status === 0 && out.stdout.trim()) return out.stdout.trim();
    throw new Error((out.stderr || 'codex failed').slice(0, 2000));
  }

  if (provider === 'claude') {
    const out = spawnSync('claude', [
      '-p',
      '--output-format', 'text',
      '--append-system-prompt', req.system,
      '--disallowed-tools', 'Bash,Read,Write,Edit,Glob,Grep,Agent,NotebookEdit',
    ], {
      input: req.prompt,
      encoding: 'utf-8',
      maxBuffer: 8 * 1024 * 1024,
      timeout: 180_000,
    });
    if (out.status === 0 && out.stdout.trim()) return out.stdout.trim();
    throw new Error((out.stderr || 'claude failed').slice(0, 2000));
  }

  return '';
}

import { execSync, spawnSync } from 'node:child_process';

export function gitDiff(projectDir: string): string {
  try {
    return execSync('git diff -- .', { cwd: projectDir, encoding: 'utf-8', maxBuffer: 4 * 1024 * 1024 });
  } catch {
    return '';
  }
}

export function applyUnifiedDiff(projectDir: string, diff: string): { success: boolean; output: string } {
  if (!diff.trim()) return { success: false, output: 'empty diff' };
  const result = spawnSync('git', ['apply', '--whitespace=nowarn'], {
    cwd: projectDir,
    input: diff,
    encoding: 'utf-8',
    maxBuffer: 4 * 1024 * 1024,
  });
  return {
    success: result.status === 0,
    output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim(),
  };
}

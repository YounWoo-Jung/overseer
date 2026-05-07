import { execSync } from 'node:child_process';

export function listProjectFiles(projectDir: string): string {
  try {
    return execSync("find . -maxdepth 3 -type f -not -path './node_modules/*' -not -path './.git/*' | sort | head -200", {
      cwd: projectDir,
      encoding: 'utf-8',
      maxBuffer: 512 * 1024,
      shell: '/bin/bash',
    });
  } catch {
    return '';
  }
}

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CheckResult, ValidationResult } from '../types.js';

function hasScript(projectDir: string, script: string): boolean {
  const packagePath = resolve(projectDir, 'package.json');
  if (!existsSync(packagePath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(packagePath, 'utf-8')) as { scripts?: Record<string, string> };
    return Boolean(pkg.scripts?.[script]);
  } catch {
    return false;
  }
}

function detectCommands(projectDir: string): { name: string; command: string }[] {
  const commands: { name: string; command: string }[] = [];
  if (hasScript(projectDir, 'typecheck')) commands.push({ name: 'typecheck', command: 'npm run typecheck' });
  if (hasScript(projectDir, 'test')) commands.push({ name: 'test', command: 'npm test -- --runInBand' });
  if (hasScript(projectDir, 'build')) commands.push({ name: 'build', command: 'npm run build' });
  if (existsSync(resolve(projectDir, 'pyproject.toml'))) commands.push({ name: 'pytest', command: 'python -m pytest' });
  return commands;
}

function runCheck(projectDir: string, name: string, command: string): CheckResult {
  const start = Date.now();
  try {
    const output = execSync(command, {
      cwd: projectDir,
      encoding: 'utf-8',
      env: { ...process.env, CI: 'true' },
      maxBuffer: 4 * 1024 * 1024,
      shell: '/bin/bash',
      timeout: 120_000,
    });
    return { name, command, success: true, skipped: false, output: output.slice(-6000), errors: [], durationMs: Date.now() - start };
  } catch (error: any) {
    const output = `${error.stdout ?? ''}\n${error.stderr ?? ''}`.trim();
    return {
      name,
      command,
      success: false,
      skipped: false,
      output: output.slice(-6000),
      errors: output.split('\n').map((line) => line.trim()).filter(Boolean).slice(-20),
      durationMs: Date.now() - start,
    };
  }
}

export function validateProject(projectDir: string): ValidationResult {
  const root = resolve(projectDir);
  const commands = detectCommands(root);
  if (commands.length === 0) {
    return {
      success: true,
      checks: [{
        name: 'validate',
        command: 'auto-detect',
        success: true,
        skipped: true,
        output: 'No known validation command found.',
        errors: [],
        durationMs: 0,
      }],
    };
  }

  const checks = commands.map((item) => runCheck(root, item.name, item.command));
  return { success: checks.every((check) => check.success), checks };
}

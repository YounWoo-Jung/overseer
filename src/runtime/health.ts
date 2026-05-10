import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { hasTmux } from './tmux.js';

export interface HealthCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: HealthCheck[];
  timestamp: string;
}

export function getHealth(projectDir: string): HealthStatus {
  const checks: HealthCheck[] = [
    checkNode(),
    checkGit(projectDir),
    { name: 'tmux', status: hasTmux() ? 'pass' : 'warn', message: hasTmux() ? 'installed' : 'not installed' },
    checkPackage(projectDir),
    checkDisk(projectDir),
  ];
  const failures = checks.filter((check) => check.status === 'fail').length;
  const warnings = checks.filter((check) => check.status === 'warn').length;
  return {
    status: failures > 0 ? 'unhealthy' : warnings > 1 ? 'degraded' : 'healthy',
    checks,
    timestamp: new Date().toISOString(),
  };
}

function checkNode(): HealthCheck {
  const major = Number(process.versions.node.split('.')[0]);
  return { name: 'node', status: major >= 20 ? 'pass' : 'fail', message: process.versions.node };
}

function checkGit(projectDir: string): HealthCheck {
  try {
    const version = execFileSync('git', ['--version'], { cwd: projectDir, encoding: 'utf-8' }).trim();
    return { name: 'git', status: 'pass', message: version };
  } catch {
    return { name: 'git', status: 'fail', message: 'git not available' };
  }
}

function checkPackage(projectDir: string): HealthCheck {
  return existsSync(resolve(projectDir, 'package.json'))
    ? { name: 'package', status: 'pass', message: 'package.json exists' }
    : { name: 'package', status: 'warn', message: 'package.json missing' };
}

function checkDisk(projectDir: string): HealthCheck {
  try {
    const output = execFileSync('df', ['-P', projectDir], { encoding: 'utf-8' }).trim().split('\n').at(-1) ?? '';
    const pct = Number(output.split(/\s+/)[4]?.replace('%', ''));
    if (pct > 90) return { name: 'disk', status: 'fail', message: `${pct}% used` };
    if (pct > 75) return { name: 'disk', status: 'warn', message: `${pct}% used` };
    return { name: 'disk', status: 'pass', message: `${pct}% used` };
  } catch {
    return { name: 'disk', status: 'warn', message: 'check skipped' };
  }
}

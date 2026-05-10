import { existsSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import type { FileSnapshot } from '../types.js';

export interface StaleWriteWarning {
  path: string;
  previousMtimeMs: number;
  currentMtimeMs: number;
}

export function snapshotFile(projectDir: string, path: string): FileSnapshot | null {
  const root = resolve(projectDir);
  const abs = resolve(root, path);
  if (!existsSync(abs)) return null;
  const stat = statSync(abs);
  if (!stat.isFile()) return null;
  return {
    path: relative(root, abs),
    mtimeMs: stat.mtimeMs,
    size: stat.size,
  };
}

export function touchedFilesFromDiff(diff: string): string[] {
  const files = new Set<string>();
  for (const line of diff.split('\n')) {
    const direct = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (direct?.[2] && direct[2] !== '/dev/null') files.add(direct[2]);
    const plus = line.match(/^\+\+\+ b\/(.+)$/);
    if (plus?.[1] && plus[1] !== '/dev/null') files.add(plus[1]);
  }
  return [...files].sort();
}

export function checkStaleWrites(projectDir: string, snapshots: FileSnapshot[] | undefined, diff: string): StaleWriteWarning[] {
  if (!snapshots?.length) return [];
  const touched = new Set(touchedFilesFromDiff(diff));
  const byPath = new Map(snapshots.map((item) => [item.path, item]));
  const warnings: StaleWriteWarning[] = [];
  for (const path of touched) {
    const previous = byPath.get(path);
    if (!previous) continue;
    const current = snapshotFile(projectDir, path);
    if (!current) continue;
    if (current.mtimeMs > previous.mtimeMs + 1) {
      warnings.push({ path, previousMtimeMs: previous.mtimeMs, currentMtimeMs: current.mtimeMs });
    }
  }
  return warnings;
}

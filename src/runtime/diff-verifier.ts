import { relative, resolve } from 'node:path';
import type { FileSnapshot } from '../types.js';
import { touchedFilesFromDiff } from './file-state.js';
import { isSensitiveWritePath } from './path-safety.js';

export interface DiffVerification {
  passed: boolean;
  touchedFiles: string[];
  warnings: string[];
  errors: string[];
}

export function verifyPatchDiff(projectDir: string, diff: string, referencedFiles?: FileSnapshot[]): DiffVerification {
  const touchedFiles = touchedFilesFromDiff(diff);
  const warnings: string[] = [];
  const errors: string[] = [];

  if (touchedFiles.length > 12) warnings.push(`large patch touches ${touchedFiles.length} files`);
  for (const file of touchedFiles) {
    if (isSensitiveWritePath(projectDir, file)) errors.push(`sensitive write blocked: ${file}`);
  }

  if (referencedFiles?.length) {
    const allowed = referencedFiles.map((file) => file.path);
    const outside = touchedFiles.filter((file) => !allowed.some((ref) => sameOrNearby(projectDir, file, ref)));
    if (outside.length) warnings.push(`diff touches files outside @ references: ${outside.slice(0, 8).join(', ')}`);
  }

  return { passed: errors.length === 0, touchedFiles, warnings, errors };
}

function sameOrNearby(projectDir: string, file: string, reference: string): boolean {
  const target = resolve(projectDir, file);
  const ref = resolve(projectDir, reference);
  if (target === ref) return true;
  const rel = relative(resolve(ref, '..'), target);
  return !rel.startsWith('..') && rel !== '..';
}

import { homedir } from 'node:os';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const SENSITIVE_HOME_DIRS = ['.ssh', '.aws', '.gnupg', '.kube', '.docker', '.azure'];
const SENSITIVE_HOME_FILES = ['.netrc', '.npmrc', '.pypirc', '.pgpass'];
const SENSITIVE_PROJECT_RE = /(^|\/)(\.env$|\.env\.(local|production|development|staging)$|config\.ya?ml$|id_rsa$|id_ed25519$)/i;

export function hasTraversalComponent(path: string): boolean {
  return path.split(/[\\/]+/).includes('..');
}

export function resolveProjectPath(projectDir: string, path: string): { success: boolean; path?: string; message?: string } {
  if (!path.trim()) return { success: false, message: 'empty path' };
  if (hasTraversalComponent(path)) return { success: false, message: 'path traversal is not allowed' };
  if (isAbsolute(path)) return { success: false, message: 'absolute path is not allowed' };
  const root = resolve(projectDir);
  const resolved = resolve(root, path);
  const rel = relative(root, resolved);
  if (rel.startsWith('..') || rel === '..' || isAbsolute(rel)) return { success: false, message: 'path escapes project root' };
  return { success: true, path: resolved };
}

export function isSensitiveWritePath(projectDir: string, path: string): boolean {
  const resolved = resolve(projectDir, path);
  const home = resolve(homedir());
  const homeRel = relative(home, resolved).split(sep).join('/');
  if (!homeRel.startsWith('..')) {
    if (SENSITIVE_HOME_FILES.includes(homeRel)) return true;
    if (SENSITIVE_HOME_DIRS.some((dir) => homeRel === dir || homeRel.startsWith(`${dir}/`))) return true;
  }

  const projectRel = relative(resolve(projectDir), resolved).split(sep).join('/');
  if (!projectRel.startsWith('..') && SENSITIVE_PROJECT_RE.test(projectRel)) return true;
  return resolved === '/etc/passwd' || resolved === '/etc/shadow' || resolved === '/etc/sudoers';
}

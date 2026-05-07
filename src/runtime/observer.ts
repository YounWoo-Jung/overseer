import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { appendAssist, appendHistory, writeProjectProfile } from '../state/history-store.js';
import { refreshTrendSkill } from '../state/trend-scout.js';

const STATE_FILE = '.overseer/observe-state.json';
const IGNORED = new Set(['node_modules', 'dist', '.git', '.overseer']);

interface FileMark {
  path: string;
  size: number;
  mtimeMs: number;
}

interface ObserveState {
  updatedAt: string;
  files: Record<string, FileMark>;
  trendRefreshedAt?: string;
}

export interface ObserveResult {
  changed: boolean;
  added: string[];
  modified: string[];
  deleted: string[];
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function walk(root: string, dir = root, out: FileMark[] = []): FileMark[] {
  for (const name of readdirSync(dir)) {
    if (IGNORED.has(name)) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(root, path, out);
      continue;
    }
    if (!stat.isFile()) continue;
    out.push({
      path: relative(root, path),
      size: stat.size,
      mtimeMs: Math.floor(stat.mtimeMs),
    });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function readPackage(root: string): {
  packageName?: string;
  scripts: string[];
  dependencies: string[];
  devDependencies: string[];
} {
  const path = join(root, 'package.json');
  if (!existsSync(path)) return { scripts: [], dependencies: [], devDependencies: [] };
  const pkg = readJson<{
    name?: string;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }>(path);
  return {
    packageName: pkg?.name,
    scripts: Object.keys(pkg?.scripts ?? {}).sort(),
    dependencies: Object.keys(pkg?.dependencies ?? {}).sort(),
    devDependencies: Object.keys(pkg?.devDependencies ?? {}).sort(),
  };
}

function writeState(root: string, state: ObserveState): void {
  const path = join(root, STATE_FILE);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}

function summarizeFocus(files: string[]): string[] {
  return files
    .map((file) => file.split('/').slice(0, 2).join('/'))
    .filter(Boolean)
    .filter((item, index, arr) => arr.indexOf(item) === index)
    .slice(0, 12);
}

export async function observeProject(projectDir: string, options: {
  trendIntervalMs?: number;
  onLog?: (message: string) => void;
} = {}): Promise<ObserveResult> {
  const root = resolve(projectDir);
  const files = walk(root);
  const current = Object.fromEntries(files.map((file) => [file.path, file]));
  const statePath = join(root, STATE_FILE);
  const previous = existsSync(statePath) ? readJson<ObserveState>(statePath) : null;
  const pkg = readPackage(root);

  writeProjectProfile(root, {
    projectDir: root,
    updatedAt: new Date().toISOString(),
    fileCount: files.length,
    packageName: pkg.packageName,
    scripts: pkg.scripts,
    dependencies: pkg.dependencies,
    devDependencies: pkg.devDependencies,
    recentFocus: summarizeFocus(files.map((file) => file.path)),
  });

  if (!previous) {
    writeState(root, { updatedAt: new Date().toISOString(), files: current });
    appendHistory(root, {
      kind: 'baseline',
      title: 'Project baseline captured',
      detail: `${files.length} files indexed for background assistance.`,
    });
    appendAssist(root, 'baseline', [
      `${files.length} files indexed.`,
      pkg.scripts.length ? `Detected scripts: ${pkg.scripts.join(', ')}` : 'No package scripts detected.',
    ]);
    options.onLog?.('observer baseline captured');
    return { changed: true, added: files.map((file) => file.path), modified: [], deleted: [] };
  }

  const added = files.map((file) => file.path).filter((file) => !previous.files[file]);
  const deleted = Object.keys(previous.files).filter((file) => !current[file]);
  const modified = files
    .filter((file) => {
      const old = previous.files[file.path];
      return old && (old.size !== file.size || old.mtimeMs !== file.mtimeMs);
    })
    .map((file) => file.path);
  const changed = added.length > 0 || modified.length > 0 || deleted.length > 0;
  const trendIntervalMs = options.trendIntervalMs ?? 24 * 60 * 60 * 1000;
  const lastTrend = previous.trendRefreshedAt ? Date.parse(previous.trendRefreshedAt) : 0;
  const shouldRefreshTrend = Date.now() - lastTrend > trendIntervalMs;

  if (changed) {
    appendHistory(root, {
      kind: 'change',
      title: 'Project changes observed',
      detail: `added ${added.length}, modified ${modified.length}, deleted ${deleted.length}`,
      files: [...added, ...modified, ...deleted].slice(0, 30),
    });
    appendAssist(root, 'change observed', [
      `Added: ${added.length}, modified: ${modified.length}, deleted: ${deleted.length}.`,
      'Review current diff before applying broad refactors.',
      pkg.scripts.includes('typecheck') ? 'Recommended check: npm run typecheck.' : '',
      pkg.scripts.includes('build') ? 'Recommended check: npm run build.' : '',
    ].filter(Boolean));
    options.onLog?.(`observer changed: +${added.length} ~${modified.length} -${deleted.length}`);
  }

  if (shouldRefreshTrend) {
    const refreshed = await refreshTrendSkill(root, {
      dependencies: [...pkg.dependencies, ...pkg.devDependencies],
      scripts: pkg.scripts,
    });
    if (refreshed) options.onLog?.('trend skill refreshed');
  }

  writeState(root, {
    updatedAt: new Date().toISOString(),
    files: current,
    trendRefreshedAt: shouldRefreshTrend ? new Date().toISOString() : previous.trendRefreshedAt,
  });
  return { changed, added, modified, deleted };
}

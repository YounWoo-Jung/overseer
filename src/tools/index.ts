import { applyUnifiedDiff, gitDiff } from './git.js';
import { registerTool } from './registry.js';
import { listProjectFiles } from './search.js';

let registered = false;

export function registerBuiltinTools(): void {
  if (registered) return;
  registered = true;

  registerTool({
    name: 'search_files',
    toolset: 'dev',
    description: 'List project files with shallow traversal.',
    handler: ({ projectDir }: { projectDir: string }) => listProjectFiles(projectDir),
  });

  registerTool({
    name: 'git_diff',
    toolset: 'dev',
    description: 'Read current git diff.',
    handler: ({ projectDir }: { projectDir: string }) => gitDiff(projectDir),
  });

  registerTool({
    name: 'apply_patch',
    toolset: 'dev',
    description: 'Apply a unified git diff.',
    handler: ({ projectDir, diff }: { projectDir: string; diff: string }) => applyUnifiedDiff(projectDir, diff),
  });
}

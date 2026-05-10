import { execFileSync, spawnSync } from 'node:child_process';
import { redactSecrets } from './redact.js';

export interface TmuxSessionInfo {
  id: string;
  name: string;
  windows: number;
  attached: boolean;
}

export interface TmuxPaneSnapshot {
  paneId: string;
  sessionName: string;
  windowIndex: string;
  active: boolean;
  currentCommand: string;
  currentPath: string;
  historySize: number;
  historyLimit: number;
  lastLine: string;
  content: string;
}

function tmux(args: string[]): string {
  return execFileSync('tmux', args, {
    encoding: 'utf-8',
    maxBuffer: 4 * 1024 * 1024,
  });
}

export function hasTmux(): boolean {
  try {
    execFileSync('which', ['tmux'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function listTmuxSessions(): TmuxSessionInfo[] {
  let output = '';
  try {
    output = tmux(['list-sessions', '-F', '#{session_id}\t#{session_name}\t#{session_windows}\t#{session_attached}']).trim();
  } catch {
    return [];
  }
  if (!output) return [];
  return output.split('\n').map((line) => {
    const [id, name, windows, attached] = line.split('\t');
    return { id, name, windows: Number(windows) || 0, attached: attached === '1' };
  });
}

export function captureTmuxPanes(target: string, maxLines = 200): TmuxPaneSnapshot[] {
  if (!target) return [];
  const args = ['list-panes', '-t', target];
  args.push('-F', '#{pane_id}\t#{session_name}\t#{window_index}\t#{pane_active}\t#{pane_current_command}\t#{pane_current_path}\t#{history_size}\t#{history_limit}');
  let output = '';
  try {
    output = tmux(args).trim();
  } catch {
    return [];
  }
  if (!output) return [];

  return output.split('\n').map((line) => {
    const [paneId, sessionName, windowIndex, active, currentCommand, currentPath, historySize, historyLimit] = line.split('\t');
    const content = capturePane(paneId, maxLines);
    const lines = content.split('\n');
    return {
      paneId,
      sessionName,
      windowIndex,
      active: active === '1',
      currentCommand,
      currentPath,
      historySize: Number(historySize) || 0,
      historyLimit: Number(historyLimit) || 0,
      lastLine: lines.at(-1)?.trim() ?? '',
      content,
    };
  });
}

function capturePane(paneId: string, maxLines: number): string {
  const output = tmux(['capture-pane', '-p', '-J', '-t', paneId, '-S', `-${maxLines}`]);
  return redactSecrets(output.trim());
}

export function sendLiteralToPane(paneId: string, text: string, enter = true): { success: boolean; output: string } {
  const sent = spawnSync('tmux', ['send-keys', '-t', paneId, '-l', text], {
    encoding: 'utf-8',
    maxBuffer: 1024 * 1024,
  });
  if (sent.status !== 0) {
    return { success: false, output: `${sent.stdout ?? ''}\n${sent.stderr ?? ''}`.trim() || 'tmux send-keys failed' };
  }
  if (!enter) return { success: true, output: '' };
  const enterSent = spawnSync('tmux', ['send-keys', '-t', paneId, 'Enter'], {
    encoding: 'utf-8',
    maxBuffer: 1024 * 1024,
  });
  return {
    success: enterSent.status === 0,
    output: `${enterSent.stdout ?? ''}\n${enterSent.stderr ?? ''}`.trim(),
  };
}

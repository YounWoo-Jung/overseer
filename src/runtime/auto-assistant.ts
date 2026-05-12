import { createHash } from 'node:crypto';
import { appendAssist, appendHistory } from '../state/history-store.js';
import { recordEvent } from '../state/event-store.js';
import { captureTmuxPanes, hasTmux, type TmuxPaneSnapshot } from './tmux.js';
import { loadAssistantConfig } from './config.js';
import { classifyPaneText, type ClassifiedSignal } from './classifier.js';
import { compactText } from './token-budget.js';
import { buildTmuxAssistInsight } from './tmux-assist.js';
import { proposeInjection } from './injector.js';
import { readClaudeCodeStatus } from './claude-code.js';
import { readCodexStatus } from './codex-context.js';
import { observeSessionRequestPatterns, type IdleSchedulerResult } from './idle-scheduler.js';
import { enqueueCommand } from './command-lane.js';
import { maybeAutopilotIdlePane } from './idle-autopilot.js';

interface AutoAssistantInput {
  projectDir: string;
  tmuxSessionName: string;
  once?: boolean;
  onLog?: (message: string) => void;
  shouldStop?: () => boolean;
}

export interface AutoAssistantScanResult {
  panes: number;
  signals: number;
  notes: number;
  requests: number;
  idle: IdleSchedulerResult['state'];
  targets: AutoAssistantPaneStatus[];
}

export interface AutoAssistantPaneStatus {
  paneId: string;
  command: string;
  active: boolean;
  currentPath: string;
  lastLine: string;
}

const AI_NAMES = ['claude', 'codex'];

export async function runAutoAssistant(input: AutoAssistantInput): Promise<void> {
  const config = loadAssistantConfig(input.projectDir);
  const intervalMs = Math.max(3000, config.watchIntervalMs);
  const seen = new Set<string>();
  input.onLog?.('auto assistant started');

  do {
    const result = await enqueueCommand('scan', async () => scanAutoAssistantOnce(input.projectDir, seen, input.tmuxSessionName));
    input.onLog?.(`ai-cli: panes ${result.panes} | signals ${result.signals} | requests ${result.requests} | idle ${result.idle} | notes ${result.notes}`);
    if (input.once) break;
    await new Promise((resolveTimer) => setTimeout(resolveTimer, intervalMs));
  } while (!input.shouldStop?.());

  input.onLog?.('auto assistant stopped');
}

export function scanAutoAssistantOnce(projectDir: string, seen: Set<string>, tmuxSessionName: string): AutoAssistantScanResult {
  const claude = readClaudeCodeStatus(projectDir);
  const codex = readCodexStatus();
  const panes = hasTmux() ? captureTmuxPanes(tmuxSessionName, loadAssistantConfig(projectDir).maxCaptureLines).filter(isAiPane) : [];
  let signals = 0;
  let notes = 0;
  const requests = observeSessionRequestPatterns(projectDir, panes);

  const scanKey = hashText(`scan:${tmuxSessionName}:${panes.map((pane) => pane.paneId).join(',')}`);
  if (!seen.has(scanKey)) {
    seen.add(scanKey);
    recordEvent(projectDir, {
      type: 'assistant.scan',
      severity: 'info',
      provenance: { source: 'system' },
      payload: {
        tmuxSessionName,
        panes: panes.length,
        claude: { found: claude.exists, memory: claude.projectMemoryFiles, dangerousSkip: claude.skipDangerousModePermissionPrompt },
        codex: { found: codex.exists, hooks: codex.hooksEnabled, memories: codex.memoriesEnabled },
      },
    });
  }

  if (claude.skipDangerousModePermissionPrompt && remember(seen, 'claude-dangerous-skip')) {
    notes += 1;
    recordEvent(projectDir, {
      type: 'claude.config.risk',
      severity: 'warning',
      provenance: { source: 'system', command: 'claude' },
      payload: { setting: 'skipDangerousModePermissionPrompt', value: true },
    });
    appendAssist(projectDir, 'Claude Code permission risk', [
      'Claude Code dangerous permission prompt skip is enabled.',
      'Prefer hook-based audit logs over tmux injection when permission prompts are bypassed.',
    ]);
  }

  if (codex.exists && (!codex.hooksEnabled || !codex.memoriesEnabled) && remember(seen, 'codex-config-notice')) {
    notes += 1;
    appendAssist(projectDir, 'Codex integration notice', [
      `hooks: ${codex.hooksEnabled ? 'on' : 'off'}`,
      `memories: ${codex.memoriesEnabled ? 'on' : 'off'}`,
      'When Codex hooks or memories are disabled, rely more on tmux and process monitoring.',
    ]);
  }

  for (const pane of panes) {
    const kind = inferPaneKind(pane);
    const dangerous = isDangerousAiArgs(pane.content);
    if (remember(seen, `pane:${pane.paneId}:${pane.currentCommand}`)) {
      recordEvent(projectDir, {
        type: 'ai_cli.pane.detected',
        severity: dangerous ? 'warning' : 'info',
        provenance: { source: 'tmux', sessionId: pane.sessionName, paneId: pane.paneId, command: pane.currentCommand },
        payload: {
          kind,
          dangerous,
          cwd: pane.currentPath,
          lastLine: pane.lastLine,
          contentPreview: compactText(pane.content, 260, 'tail'),
        },
      });
      if (dangerous) {
        appendAssist(projectDir, 'AI CLI dangerous mode detected', [
          `Pane: ${pane.paneId} (${pane.sessionName})`,
          `Command: ${pane.currentCommand}`,
          'For permission or sandbox bypass mode, prefer audit logs and the approval queue over automatic control.',
        ]);
      }
    }

    const paneSignals = classifyPaneText(pane.content);
    signals += paneSignals.length;
    for (const signal of paneSignals) {
      const signalKey = `signal:${pane.paneId}:${signal.type}:${signal.evidence}`;
      if (!remember(seen, signalKey)) continue;
      recordEvent(projectDir, {
        type: signal.type,
        severity: signal.severity,
        provenance: { source: 'tmux', sessionId: pane.sessionName, paneId: pane.paneId, command: pane.currentCommand },
        payload: {
          title: signal.title,
          suggestion: signal.suggestion,
          evidence: signal.evidence,
        },
      });
      const insight = buildTmuxAssistInsight(projectDir, signal);
      appendAssist(projectDir, signal.title, [
        `Pane: ${pane.paneId} (${pane.sessionName})`,
        ...insight.assistLines,
      ]);
      if (shouldProposeInjectionForSignal(signal)) {
        proposeInjection(projectDir, {
          paneId: pane.paneId,
          sessionName: pane.sessionName,
          message: insight.prompt,
          reason: `${signal.type}: ${signal.evidence}`,
          dedupKey: hashText(signalKey),
        });
      }
    }
  }

  if (panes.length === 0 && remember(seen, 'no-ai-cli')) {
    notes += 1;
    appendHistory(projectDir, {
      kind: 'note',
      title: 'No running AI CLI detected',
      detail: `Claude/Codex local context is available, but no AI CLI running inside tmux session ${tmuxSessionName} was detected.`,
    });
  }

  const autopilot = maybeAutopilotIdlePane(projectDir, panes);
  if (autopilot.fired > 0) notes += autopilot.fired;

  return {
    panes: panes.length,
    signals,
    notes,
    requests,
    idle: 'waiting' as IdleSchedulerResult['state'],
    targets: panes.map((pane) => ({
      paneId: pane.paneId,
      command: pane.currentCommand,
      active: pane.active,
      currentPath: pane.currentPath,
      lastLine: compactText(pane.lastLine, 120, 'tail'),
    })),
  };
}

export function shouldProposeInjectionForSignal(signal: Pick<ClassifiedSignal, 'severity' | 'type'>): boolean {
  return signal.severity !== 'info' && signal.type !== 'permission.required';
}

function inferPaneKind(pane: TmuxPaneSnapshot): string {
  return inferCommandKind(pane.currentCommand, pane.content) || 'ai-cli';
}

function inferCommandKind(command: string, args: string): string {
  const cmd = command.toLowerCase();
  const text = args.toLowerCase();
  const direct = AI_NAMES.find((name) => cmd === name || cmd.includes(name));
  if (direct) return direct;
  if (cmd === 'node') {
    if (/\/bin\/codex\b|@openai\/codex/.test(text)) return 'codex';
  }
  if (/^claude(\s|$)/.test(text)) return 'claude';
  if (/^codex(\s|$)/.test(text)) return 'codex';
  return '';
}

function isDangerousAiArgs(args: string): boolean {
  return /dangerously|bypass-approvals|bypass permissions|skip-permissions|danger-no-sandbox/i.test(args);
}

function isAiPane(pane: TmuxPaneSnapshot): boolean {
  if (AI_NAMES.some((name) => pane.currentCommand.toLowerCase().includes(name))) return true;
  if (pane.currentCommand !== 'node') return false;
  return /\b(gpt-\d|claude|codex|Use \/skills|bypass permissions)\b/i.test(pane.content);
}

function remember(seen: Set<string>, key: string): boolean {
  const hashed = hashText(key);
  if (seen.has(hashed)) return false;
  seen.add(hashed);
  return true;
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

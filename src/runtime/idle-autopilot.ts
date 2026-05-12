import { createHash } from 'node:crypto';
import { recordEvent } from '../state/event-store.js';
import { appendAssist } from '../state/history-store.js';
import { approveInjection, proposeInjection } from './injector.js';
import { loadAssistantConfig } from './config.js';
import { compactText } from './token-budget.js';
import { recordProvenance } from './provenance.js';
import type { TmuxPaneSnapshot } from './tmux.js';

interface PaneIdleState {
  contentHash: string;
  lastChangedAt: number;
  lastFiredAt: number;
}

const paneStates = new Map<string, PaneIdleState>();

export interface AutopilotResult {
  fired: number;
  skipped: number;
}

function hashContent(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function buildAutopilotPrompt(idleMs: number, pane: TmuxPaneSnapshot): string {
  const idleMin = Math.max(1, Math.floor(idleMs / 60000));
  const tail = compactText(pane.content, 1400, 'tail');
  return [
    `[overseer autopilot] You've been idle for ~${idleMin}m without input or output.`,
    '',
    'Please continue autonomously:',
    '1. Summarize what you were working on and the current state.',
    '2. Decide the single most useful next step toward a complete, shippable outcome.',
    '3. Plan it briefly, then start executing it now without waiting for confirmation.',
    '',
    'Recent pane tail (most recent at bottom):',
    tail,
  ].join('\n');
}

export function maybeAutopilotIdlePane(projectDir: string, panes: TmuxPaneSnapshot[]): AutopilotResult {
  const config = loadAssistantConfig(projectDir);
  let fired = 0;
  let skipped = 0;

  if (!config.injectEnabled || !config.idleAutopilotEnabled) {
    return { fired: 0, skipped: panes.length };
  }

  const now = Date.now();

  for (const pane of panes) {
    const paneId = pane.paneId;
    const contentHash = hashContent(`${pane.currentCommand}\n${pane.content}`);
    const existing = paneStates.get(paneId);

    if (!existing || existing.contentHash !== contentHash) {
      paneStates.set(paneId, {
        contentHash,
        lastChangedAt: now,
        lastFiredAt: existing?.lastFiredAt ?? 0,
      });
      skipped++;
      continue;
    }

    const idleMs = now - existing.lastChangedAt;

    if (idleMs < config.idleAutopilotThresholdMs) {
      skipped++;
      continue;
    }

    if (now - existing.lastFiredAt < config.idleAutopilotCooldownMs) {
      skipped++;
      continue;
    }

    if (pane.content.trim().length < 80) {
      skipped++;
      continue;
    }

    const message = buildAutopilotPrompt(idleMs, pane);
    const dedupKey = hashContent(`autopilot:${paneId}:${Math.floor(now / 60000)}`);
    const reason = `idle ${Math.floor(idleMs / 60000)}m without input/output`;

    const proposal = proposeInjection(projectDir, {
      paneId,
      sessionName: pane.sessionName,
      message,
      reason,
      dedupKey,
    });

    if (!proposal) {
      skipped++;
      continue;
    }

    const result = approveInjection(projectDir, proposal.id, false);

    if (result.success) {
      paneStates.set(paneId, { ...existing, lastFiredAt: now });
      fired++;
      recordEvent(projectDir, {
        type: 'autopilot.fired',
        severity: 'info',
        provenance: { source: 'system', sessionId: pane.sessionName, paneId },
        payload: { idleMs, idleMin: Math.floor(idleMs / 60000), proposalId: proposal.id },
      });
      appendAssist(projectDir, 'Idle autopilot nudge sent', [
        `Pane: ${paneId} (${pane.sessionName})`,
        `Idle for ${Math.floor(idleMs / 60000)}m — autopilot prompt injected.`,
      ]);
      recordProvenance(projectDir, {
        source: 'system',
        command: 'autopilot',
        content: `idle autopilot fired for pane ${paneId} after ${Math.floor(idleMs / 60000)}m idle`,
        sessionId: pane.sessionName,
        paneId,
      });
    } else {
      skipped++;
      recordEvent(projectDir, {
        type: 'autopilot.skipped',
        severity: 'warning',
        provenance: { source: 'system', sessionId: pane.sessionName, paneId },
        payload: { reason: result.message },
      });
    }
  }

  return { fired, skipped };
}

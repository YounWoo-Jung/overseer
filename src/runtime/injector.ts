import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { recordEvent } from '../state/event-store.js';
import { loadAssistantConfig } from './config.js';
import { redactSecrets } from './redact.js';
import { scoreInjectionText, type RiskAssessment } from './risk-scorer.js';
import { captureTmuxPanes, sendLiteralToPane } from './tmux.js';

const STATE_DIR = '.overseer';
const INJECTIONS_FILE = 'injections.jsonl';
const COOLDOWN_FILE = 'inject-cooldown.json';

export type InjectionState = 'proposed' | 'sent' | 'denied' | 'blocked';

export interface InjectionProposal {
  id: string;
  createdAt: string;
  updatedAt: string;
  state: InjectionState;
  paneId: string;
  sessionName: string;
  message: string;
  reason: string;
  risk: RiskAssessment;
  dedupKey: string;
}

function stateDir(projectDir: string): string {
  return join(resolve(projectDir), STATE_DIR);
}

function injectionsPath(projectDir: string): string {
  return join(stateDir(projectDir), INJECTIONS_FILE);
}

function cooldownPath(projectDir: string): string {
  return join(stateDir(projectDir), COOLDOWN_FILE);
}

function ensureState(projectDir: string): void {
  mkdirSync(stateDir(projectDir), { recursive: true });
  if (!existsSync(injectionsPath(projectDir))) writeFileSync(injectionsPath(projectDir), '');
}

function id(): string {
  return `inj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function proposeInjection(projectDir: string, input: {
  paneId: string;
  sessionName: string;
  message: string;
  reason: string;
  dedupKey: string;
}): InjectionProposal | null {
  ensureState(projectDir);
  const existing = listInjections(projectDir, 200).find((proposal) =>
    proposal.dedupKey === input.dedupKey && (proposal.state === 'proposed' || proposal.state === 'sent')
  );
  if (existing) return null;

  const message = redactSecrets(input.message).slice(0, 700);
  const proposal: InjectionProposal = {
    id: id(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    state: 'proposed',
    paneId: input.paneId,
    sessionName: input.sessionName,
    message,
    reason: redactSecrets(input.reason).slice(0, 500),
    risk: scoreInjectionText(message),
    dedupKey: input.dedupKey,
  };
  appendFileSync(injectionsPath(projectDir), `${JSON.stringify(proposal)}\n`);
  recordEvent(projectDir, {
    type: 'inject.proposed',
    severity: proposal.risk.level === 'danger' ? 'warning' : 'info',
    provenance: { source: 'agent', sessionId: input.sessionName, paneId: input.paneId },
    payload: { id: proposal.id, risk: proposal.risk.level, reason: proposal.reason, message: proposal.message },
  });
  return proposal;
}

export function listInjections(projectDir: string, limit = 50): InjectionProposal[] {
  ensureState(projectDir);
  return readFileSync(injectionsPath(projectDir), 'utf-8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as InjectionProposal;
      } catch {
        return null;
      }
    })
    .filter((proposal): proposal is InjectionProposal => Boolean(proposal))
    .slice(-limit);
}

export function approveInjection(projectDir: string, id: string, force = false): { success: boolean; message: string } {
  const proposal = [...listInjections(projectDir, 500)].reverse().find((item) => item.id === id);
  if (!proposal) return { success: false, message: 'proposal not found' };
  if (proposal.state !== 'proposed') return { success: false, message: `proposal is ${proposal.state}` };
  if (proposal.risk.hardline) {
    appendState(projectDir, { ...proposal, state: 'blocked', updatedAt: new Date().toISOString() });
    recordEvent(projectDir, {
      type: 'inject.blocked',
      severity: 'critical',
      provenance: { source: 'user', sessionId: proposal.sessionName, paneId: proposal.paneId },
      payload: { id: proposal.id, reason: 'hardline risk', flags: proposal.risk.flags },
    });
    return { success: false, message: 'hardline risk blocked' };
  }
  if (proposal.risk.level === 'danger' && !force) return { success: false, message: 'danger risk requires --force' };

  const config = loadAssistantConfig(projectDir);
  const cooldown = readCooldown(projectDir);
  const now = Date.now();
  const last = cooldown[proposal.dedupKey] ?? 0;
  if (now - last < config.injectCooldownMs && !force) {
    return { success: false, message: 'cooldown active' };
  }
  const pane = captureTmuxPanes(proposal.paneId, 5)[0];
  if (pane && !isLikelyAiCliPane(pane.currentCommand) && !force) {
    appendState(projectDir, { ...proposal, state: 'blocked', updatedAt: new Date().toISOString() });
    recordEvent(projectDir, {
      type: 'inject.blocked',
      severity: 'warning',
      provenance: { source: 'user', sessionId: proposal.sessionName, paneId: proposal.paneId },
      payload: { id: proposal.id, reason: `target command is ${pane.currentCommand}` },
    });
    return { success: false, message: `target pane is not an AI CLI (${pane.currentCommand}); use --force to override` };
  }

  const sent = sendLiteralToPane(proposal.paneId, proposal.message, true);
  const state: InjectionState = sent.success ? 'sent' : 'blocked';
  appendState(projectDir, { ...proposal, state, updatedAt: new Date().toISOString() });
  if (sent.success) {
    cooldown[proposal.dedupKey] = now;
    writeCooldown(projectDir, cooldown);
  }
  recordEvent(projectDir, {
    type: sent.success ? 'inject.sent' : 'inject.blocked',
    severity: sent.success ? 'info' : 'warning',
    provenance: { source: 'user', sessionId: proposal.sessionName, paneId: proposal.paneId },
    payload: { id: proposal.id, risk: proposal.risk.level, output: sent.output },
  });
  return { success: sent.success, message: sent.success ? 'sent' : sent.output };
}

export function denyInjection(projectDir: string, id: string): boolean {
  const proposal = [...listInjections(projectDir, 500)].reverse().find((item) => item.id === id);
  if (!proposal || proposal.state !== 'proposed') return false;
  appendState(projectDir, { ...proposal, state: 'denied', updatedAt: new Date().toISOString() });
  recordEvent(projectDir, {
    type: 'inject.denied',
    severity: 'info',
    provenance: { source: 'user', sessionId: proposal.sessionName, paneId: proposal.paneId },
    payload: { id: proposal.id },
  });
  return true;
}

function appendState(projectDir: string, proposal: InjectionProposal): void {
  ensureState(projectDir);
  appendFileSync(injectionsPath(projectDir), `${JSON.stringify(proposal)}\n`);
}

function readCooldown(projectDir: string): Record<string, number> {
  try {
    return JSON.parse(readFileSync(cooldownPath(projectDir), 'utf-8')) as Record<string, number>;
  } catch {
    return {};
  }
}

function writeCooldown(projectDir: string, cooldown: Record<string, number>): void {
  ensureState(projectDir);
  writeFileSync(cooldownPath(projectDir), `${JSON.stringify(cooldown, null, 2)}\n`);
}

function isLikelyAiCliPane(command: string): boolean {
  const normalized = command.toLowerCase();
  return ['claude', 'codex'].some((name) => normalized.includes(name))
    || normalized === 'node';
}

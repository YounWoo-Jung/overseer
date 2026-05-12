#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { App } from './tui/App.js';
import { readRunRecords } from './state/learning-store.js';
import { getRankedSkillStats } from './state/skill-stats.js';
import { readHistory, readProjectProfile } from './state/history-store.js';
import { compactText, estimateTokens, readTokenBudget } from './runtime/token-budget.js';
import { loadAssistantConfig } from './runtime/config.js';
import { captureTmuxPanes, hasTmux, listTmuxSessions } from './runtime/tmux.js';
import { readEvents, recordEvent } from './state/event-store.js';
import { classifyPaneText } from './runtime/classifier.js';
import { appendAssist } from './state/history-store.js';
import { approveInjection, denyInjection, listInjections, proposeInjection } from './runtime/injector.js';
import { autoMatchSkills, indexSkills } from './state/skill-registry.js';
import { buildTmuxAssistInsight } from './runtime/tmux-assist.js';
import { importClaudeCodeMemory, readClaudeCodeStatus, recordClaudeCodeHook } from './runtime/claude-code.js';
import { importCodexMemory, readCodexStatus, recordCodexHook } from './runtime/codex-context.js';
import { runAutoAssistant, shouldProposeInjectionForSignal } from './runtime/auto-assistant.js';
import { readIdleSchedulerSnapshot } from './runtime/idle-scheduler.js';
import { evaluateDone, readDoneReport } from './runtime/completion.js';
import { getHealth } from './runtime/health.js';
import { readProvenance, recordProvenance, summarizeProvenance } from './runtime/provenance.js';
import { getLaneStats } from './runtime/command-lane.js';

function usage(): void {
  console.log([
    'overseer',
    'AI CLI development assistant',
    '',
    'Usage:',
    '  overseer <tmux-session>  Start unified monitoring TUI for one tmux session',
    '  overseer done [dir]       Show completion verdict',
    '  overseer doctor [dir]     Show local health checks',
    '  overseer provenance [dir] Show input provenance log',
    '  overseer tmux panes <tmux-session>',
    '  overseer tmux watch <tmux-session> [--once]',
    '',
    'TUI commands:',
    '  /calls       Show call/event log',
    '  /audit       Show audit index and risks',
    '  /knowledge   Show development pattern and knowledge state',
    '  /logs        Show assistant operation log',
    '  /scan        Run monitor scan now',
    '  /help        Show TUI help',
    '',
  ].join('\n'));
}

const KNOWN_COMMANDS = new Set([
  'status',
  'tokens',
  'claude',
  'claude-hook',
  'codex',
  'codex-hook',
  'skills',
  'events',
  'inject',
  'done',
  'doctor',
  'provenance',
  'tmux',
  'inbox',
  'tui',
]);

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;

  if (command === '--help' || command === '-h') {
    usage();
    return;
  }

  if (!command) {
    usage();
    process.exitCode = 1;
    return;
  }

  if (command === '--session' || command === '-s') {
    const tmuxSessionName = rest[0];
    if (!tmuxSessionName) {
      usage();
      process.exitCode = 1;
      return;
    }
    await startMonitor(tmuxSessionName, process.cwd());
    return;
  }

  if (!KNOWN_COMMANDS.has(command)) {
    const tmuxSessionName = [command, ...rest].join(' ').trim();
    await startMonitor(tmuxSessionName, process.cwd());
    return;
  }

  if (command === 'status') {
    const projectDir = rest[0] ? resolve(rest[0]) : process.cwd();
    const history = readHistory(projectDir);
    const events = readEvents(projectDir);
    const profile = readProjectProfile(projectDir);
    const budget = readTokenBudget();
    const config = loadAssistantConfig(projectDir);
    const idle = readIdleSchedulerSnapshot(projectDir);
    const injections = listInjections(projectDir, 100);
    console.log(`project: ${projectDir}`);
    console.log(`history: ${history.length} recent records | events: ${events.length}${profile ? ` | files: ${profile.fileCount}` : ''}`);
    console.log(`inject: proposed ${injections.filter((item) => item.state === 'proposed').length} | sent ${injections.filter((item) => item.state === 'sent').length} | blocked ${injections.filter((item) => item.state === 'blocked').length}`);
    console.log(`token budget: prompt ${budget.maxPromptTokens} | context ${budget.maxContextTokens}`);
    console.log(`tmux: capture ${config.maxCaptureLines} lines | watch ${config.watchIntervalMs}ms | inject ${config.injectEnabled ? 'on' : 'off'}`);
    console.log(`idle scheduler: ${config.idleSchedulerEnabled ? 'on' : 'off'} | threshold ${config.idleThresholdMs}ms | interval ${config.idleSchedulerIntervalMs}ms`);
    console.log(`idle autopilot: ${config.idleAutopilotEnabled ? 'on' : 'off'} | threshold ${config.idleAutopilotThresholdMs}ms | cooldown ${config.idleAutopilotCooldownMs}ms`);
    console.log(`idle backlog: open ${idle.openBacklog}${idle.topGoal ? ` | top ${idle.topPriority}: ${idle.topGoal}` : ''}`);
    console.log(`request direction: ${idle.direction}`);
    console.log(`lanes: ${Object.entries(getLaneStats()).map(([lane, stat]) => `${lane}:${stat.active ? 'active' : 'idle'}/${stat.queued}`).join(' ')}`);
    console.log(`provenance: ${Object.entries(summarizeProvenance(projectDir)).filter(([, count]) => count > 0).map(([source, count]) => `${source}:${count}`).join(' ') || 'empty'}`);
    const claude = readClaudeCodeStatus(projectDir);
    const codex = readCodexStatus();
    console.log(`claude: ${claude.exists ? 'found' : 'missing'} | memory ${claude.projectMemoryFiles} | dangerous-skip ${claude.skipDangerousModePermissionPrompt ? 'on' : 'off'}`);
    console.log(`codex: ${codex.exists ? 'found' : 'missing'} | hooks ${codex.hooksEnabled ? 'on' : 'off'} | memories ${codex.memoriesEnabled ? 'on' : 'off'}`);
    const doneReport = readDoneReport(projectDir);
    if (doneReport) {
      const summary = doneReport.split('\n').find((line) => line.startsWith('## '))?.replace(/^##\s+/, '');
      if (summary) console.log(`completion: ${summary}`);
    }
    const skills = getRankedSkillStats(projectDir);
    if (skills.length > 0) {
      console.log('skills:');
      for (const skill of skills.slice(0, 8)) {
        console.log(`- ${skill.name}: score=${skill.score.toFixed(2)}, runs=${skill.runs}, failures=${skill.failures}${skill.disabled ? ' disabled' : ''}`);
      }
    }
    return;
  }

  if (command === 'tokens') {
    const path = rest[0];
    if (!path && process.stdin.isTTY) {
      console.log('usage: overseer tokens [file]  or  command | overseer tokens');
      return;
    }
    const input = path ? readFileSync(resolve(path), 'utf-8') : await readStdin();
    const budget = readTokenBudget();
    console.log(`tokens: approx ${estimateTokens(input)}`);
    console.log(`filtered: approx ${estimateTokens(compactText(input, budget.maxHistoryTokens, 'middle'))}`);
    return;
  }

  if (command === 'claude') {
    const [action, dir] = rest;
    const projectDir = dir ? resolve(dir) : process.cwd();
    if (action === 'status') {
      const status = readClaudeCodeStatus(projectDir);
      console.log(`home: ${status.home} | ${status.exists ? 'found' : 'missing'}`);
      console.log(`settings: ${status.settingsPath}`);
      console.log(`user memory: ${status.hasUserMemory ? 'yes' : 'no'} | dangerous-skip: ${status.skipDangerousModePermissionPrompt ? 'on' : 'off'} | plugins: ${status.enabledPlugins}`);
      console.log(`project memory: ${status.projectMemoryFiles} files | ${status.projectMemoryPath}`);
      console.log(`components: commands ${status.userComponents.commands} | skills ${status.userComponents.skills} | agents ${status.userComponents.agents} | rules ${status.userComponents.rules}`);
      return;
    }
    if (action === 'import-memory') {
      const result = importClaudeCodeMemory(projectDir);
      console.log(`imported: ${result.imported} | ${result.path}`);
      return;
    }
    usage();
    process.exitCode = 1;
    return;
  }

  if (command === 'claude-hook') {
    const projectDir = rest[0] ? resolve(rest[0]) : process.cwd();
    const raw = await readStdin();
    recordClaudeCodeHook(projectDir, JSON.parse(raw || '{}') as Record<string, unknown>);
    console.log('{}');
    return;
  }

  if (command === 'codex') {
    const [action, dir] = rest;
    const projectDir = dir ? resolve(dir) : process.cwd();
    if (action === 'status') {
      const status = readCodexStatus();
      console.log(`home: ${status.home} | ${status.exists ? 'found' : 'missing'}`);
      console.log(`config: ${status.configPath}`);
      console.log(`permissions: ${status.defaultPermissions ?? 'unset'} | hooks: ${status.hooksEnabled ? 'on' : 'off'} | memories: ${status.memoriesEnabled ? 'on' : 'off'}`);
      console.log(`global AGENTS.md: ${status.hasGlobalAgents ? 'yes' : 'no'} | rules: ${status.rules}`);
      console.log(`skills: user ${status.userSkills} | system ${status.systemSkills}`);
      console.log(`memory files: ${status.memoryFiles} | sessions: ${status.sessionFiles}`);
      return;
    }
    if (action === 'import-memory') {
      const result = importCodexMemory(projectDir);
      console.log(`imported: ${result.imported} | ${result.path}`);
      return;
    }
    usage();
    process.exitCode = 1;
    return;
  }

  if (command === 'codex-hook') {
    const projectDir = rest[0] ? resolve(rest[0]) : process.cwd();
    const raw = await readStdin();
    recordCodexHook(projectDir, JSON.parse(raw || '{}') as Record<string, unknown>);
    console.log('{}');
    return;
  }

  if (command === 'skills') {
    const projectDir = rest[0] ? resolve(rest[0]) : process.cwd();
    const skills = indexSkills(projectDir);
    const profile = readProjectProfile(projectDir);
    const matched = new Set(autoMatchSkills(projectDir, JSON.stringify(profile ?? {}), 8).map((skill) => skill.name));
    if (skills.length === 0) {
      console.log('skills: empty');
      return;
    }
    for (const skill of skills) {
      console.log(`${matched.has(skill.name) ? '*' : '-'} ${skill.name} tokens=${skill.bodyTokens} score=${skill.score.toFixed(2)}`);
      console.log(`  ${skill.description}`);
    }
    return;
  }

  if (command === 'events') {
    const projectDir = rest[0] ? resolve(rest[0]) : process.cwd();
    const events = readEvents(projectDir, 20).reverse();
    if (events.length === 0) {
      console.log('events: empty');
      return;
    }
    for (const event of events) {
      console.log(`${event.timestamp} [${event.severity}] ${event.type}`);
      console.log(`  source: ${event.provenance.source}${event.provenance.paneId ? ` | pane: ${event.provenance.paneId}` : ''}`);
      console.log(`  ${JSON.stringify(event.payload)}`);
    }
    return;
  }

  if (command === 'inject') {
    const [action, id] = rest;
    const projectDir = process.cwd();
    if (action === 'list') {
      const proposals = listInjections(projectDir, 30).reverse();
      if (proposals.length === 0) {
        console.log('inject: empty');
        return;
      }
      for (const proposal of proposals) {
        console.log(`${proposal.id} [${proposal.state}] risk=${proposal.risk.level} pane=${proposal.paneId} session=${proposal.sessionName}`);
        console.log(`  reason: ${proposal.reason}`);
        console.log(`  prompt: ${proposal.message}`);
      }
      return;
    }
    if (action === 'approve' && id) {
      const result = approveInjection(projectDir, id, rest.includes('--force'));
      console.log(`${result.success ? 'sent' : 'blocked'}: ${result.message}`);
      process.exitCode = result.success ? 0 : 1;
      return;
    }
    if (action === 'deny' && id) {
      const ok = denyInjection(projectDir, id);
      console.log(ok ? 'denied' : 'not found');
      process.exitCode = ok ? 0 : 1;
      return;
    }
    usage();
    process.exitCode = 1;
    return;
  }

  if (command === 'done') {
    const projectDir = rest[0] ? resolve(rest[0]) : process.cwd();
    const verdict = evaluateDone(projectDir);
    console.log(verdict.summary);
    for (const check of verdict.checks) {
      console.log(`${check.passed ? 'pass' : 'fail'} ${check.required ? 'required' : 'optional'} ${check.name}: ${check.message}`);
    }
    return;
  }

  if (command === 'doctor') {
    const projectDir = rest[0] ? resolve(rest[0]) : process.cwd();
    const health = getHealth(projectDir);
    console.log(`health: ${health.status}`);
    for (const check of health.checks) {
      console.log(`${check.status} ${check.name}: ${check.message}`);
    }
    return;
  }

  if (command === 'provenance') {
    const projectDir = rest[0] ? resolve(rest[0]) : process.cwd();
    const records = readProvenance(projectDir, 20).reverse();
    if (records.length === 0) {
      console.log('provenance: empty');
      return;
    }
    for (const record of records) {
      console.log(`${record.timestamp} [${record.source}] ${record.command ?? ''} ${record.content}`);
    }
    return;
  }

  if (command === 'tmux') {
    const [action] = rest;
    const target = rest.slice(1).find((item) => item !== '--once') ?? '';
    if (action === 'panes' && !target) {
      console.log('usage: overseer tmux panes <tmux-session>');
      process.exitCode = 1;
      return;
    }
    if (action === 'watch' && !target) {
      console.log('usage: overseer tmux watch <tmux-session> [--once]');
      process.exitCode = 1;
      return;
    }
    if (!hasTmux()) {
      console.log('tmux: not installed');
      process.exitCode = 1;
      return;
    }
    if (action === 'sessions') {
      const sessions = listTmuxSessions();
      for (const session of sessions) {
        console.log(`${session.name} (${session.id}) windows=${session.windows} attached=${session.attached}`);
      }
      return;
    }
    if (action === 'panes') {
      const projectDir = process.cwd();
      const config = loadAssistantConfig(projectDir);
      const panes = captureTmuxPanes(target, config.maxCaptureLines);
      recordEvent(projectDir, {
        type: 'tmux.captured',
        severity: 'info',
        provenance: { source: 'tmux', sessionId: target },
        payload: { target, panes: panes.length },
      });
      for (const pane of panes) {
        console.log(`${pane.paneId} ${pane.sessionName}:${pane.windowIndex} active=${pane.active} cmd=${pane.currentCommand}`);
        console.log(`  cwd: ${pane.currentPath}`);
        console.log(`  last: ${pane.lastLine}`);
      }
      return;
    }
    if (action === 'watch') {
      await watchTmux(target, rest.includes('--once'));
      return;
    }
    usage();
    process.exitCode = 1;
    return;
  }

  if (command === 'inbox') {
    const projectDir = rest[0] ? resolve(rest[0]) : process.cwd();
    const history = readHistory(projectDir, 12).reverse();
    if (history.length === 0) {
      console.log('inbox: empty');
      return;
    }
    for (const item of history) {
      console.log(`${item.timestamp} [${item.kind}] ${item.title}`);
      console.log(`  ${item.detail}`);
      if (item.files?.length) console.log(`  files: ${item.files.slice(0, 5).join(', ')}`);
    }
    return;
  }

  if (command === 'tui') {
    const tmuxSessionName = rest[0];
    const projectDir = rest[1] ? resolve(rest[1]) : process.cwd();
    if (!tmuxSessionName) {
      usage();
      process.exitCode = 1;
      return;
    }
    await startMonitor(tmuxSessionName, projectDir);
    return;
  }

  usage();
  process.exitCode = 1;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

async function startMonitor(tmuxSessionName: string, projectDir: string): Promise<void> {
  if (!process.stdin.isTTY) {
    let stopping = false;
    process.once('SIGINT', () => { stopping = true; });
    process.once('SIGTERM', () => { stopping = true; });
    await runAutoAssistant({
      projectDir,
      tmuxSessionName,
      onLog: (message) => console.log(`[assist] ${message}`),
      shouldStop: () => stopping,
    });
    return;
  }
  render(<App projectDir={projectDir} tmuxSessionName={tmuxSessionName} />, { exitOnCtrlC: true });
}

async function watchTmux(target: string, once: boolean): Promise<void> {
  const projectDir = process.cwd();
  const config = loadAssistantConfig(projectDir);
  const seen = new Map<string, string>();
  const seenSignals = new Set<string>();
  let stopping = false;
  process.once('SIGINT', () => { stopping = true; });
  process.once('SIGTERM', () => { stopping = true; });

  do {
    const panes = captureTmuxPanes(target, config.maxCaptureLines);
    let changed = 0;
    for (const pane of panes) {
      const hash = hashText(`${pane.currentCommand}\n${pane.currentPath}\n${pane.content}`);
      if (seen.get(pane.paneId) === hash) continue;
      seen.set(pane.paneId, hash);
      changed += 1;
      recordEvent(projectDir, {
        type: 'tmux.changed',
        severity: 'info',
        provenance: {
          source: 'tmux',
          sessionId: pane.sessionName,
          paneId: pane.paneId,
          command: pane.currentCommand,
        },
        payload: {
          windowIndex: pane.windowIndex,
          currentPath: pane.currentPath,
          lastLine: pane.lastLine,
          contentPreview: compactText(pane.content, 300, 'tail'),
        },
      });
      for (const signal of classifyPaneText(pane.content)) {
        const signalKey = hashText(`${pane.paneId}:${signal.type}:${signal.evidence}`);
        if (seenSignals.has(signalKey)) continue;
        seenSignals.add(signalKey);
        recordEvent(projectDir, {
          type: signal.type,
          severity: signal.severity,
          provenance: {
            source: 'tmux',
            sessionId: pane.sessionName,
            paneId: pane.paneId,
            command: pane.currentCommand,
          },
          payload: {
            title: signal.title,
            suggestion: signal.suggestion,
            evidence: signal.evidence,
          },
        });
        const insight = buildTmuxAssistInsight(projectDir, signal);
        if (signal.severity !== 'info') {
          appendAssist(projectDir, signal.title, [
            `Pane: ${pane.paneId} (${pane.sessionName})`,
            ...insight.assistLines,
          ]);
        }
        if (shouldProposeInjectionForSignal(signal)) {
          proposeInjection(projectDir, {
            paneId: pane.paneId,
            sessionName: pane.sessionName,
            message: insight.prompt,
            reason: `${signal.type}: ${signal.evidence}`,
            dedupKey: hashText(`${pane.paneId}:${signal.type}:${signal.evidence}`),
          });
        }
      }
    }
    console.log(`tmux watch: panes=${panes.length} changed=${changed}`);
    if (once) break;
    await new Promise((resolveTimer) => setTimeout(resolveTimer, config.watchIntervalMs));
  } while (!stopping);
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

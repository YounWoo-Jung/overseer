import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { readRunRecords } from '../state/learning-store.js';
import { getRankedSkillStats } from '../state/skill-stats.js';
import { readHistory, readProjectProfile } from '../state/history-store.js';
import { readEvents, type AssistantEventRecord } from '../state/event-store.js';
import { indexSkills } from '../state/skill-registry.js';
import { listInjections, approveInjection, denyInjection } from '../runtime/injector.js';
import { readClaudeCodeStatus } from '../runtime/claude-code.js';
import { readCodexStatus } from '../runtime/codex-context.js';
import { scanAutoAssistantOnce, type AutoAssistantScanResult } from '../runtime/auto-assistant.js';
import { readIdleSchedulerSnapshot, recordUserRequestPattern } from '../runtime/idle-scheduler.js';
import { readTokenBudget } from '../runtime/token-budget.js';
import { getLaneStats } from '../runtime/command-lane.js';
import { recordProvenance, summarizeProvenance } from '../runtime/provenance.js';

type ViewMode = 'dashboard' | 'calls' | 'audit' | 'knowledge' | 'logs' | 'runs' | 'skills' | 'inbox' | 'inject' | 'help';

function truncate(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, Math.max(0, length - 1))}.` : text;
}

function scoreIndexes(input: {
  events: AssistantEventRecord[];
  histories: number;
  runs: number;
  skills: number;
  memories: number;
}): { audit: number; analysis: number; knowledge: number } {
  const warnings = input.events.filter((event) => event.severity === 'warning').length;
  const errors = input.events.filter((event) => event.severity === 'error').length;
  const critical = input.events.filter((event) => event.severity === 'critical').length;
  return {
    audit: clamp(100 - warnings * 5 - errors * 10 - critical * 20, 0, 100),
    analysis: clamp(input.events.length * 2 + input.histories * 4 + input.runs * 6, 0, 100),
    knowledge: clamp(input.skills * 6 + input.memories * 8 + input.histories * 3, 0, 100),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function scoreColor(value: number): string {
  if (value >= 80) return 'green';
  if (value >= 50) return 'yellow';
  return 'red';
}

function logLine(message: string): string {
  return `${new Date().toLocaleTimeString()} ${message}`;
}

export function App({ projectDir, tmuxSessionName }: { projectDir: string; tmuxSessionName: string }) {
  const { exit } = useApp();
  const seenRef = useRef(new Set<string>());
  const [task, setTask] = useState('');
  const [view, setView] = useState<ViewMode>('dashboard');
  const [notice, setNotice] = useState('type /help for TUI commands');
  const [refreshTick, setRefreshTick] = useState(Date.now());
  const [scanResult, setScanResult] = useState<AutoAssistantScanResult>({ panes: 0, signals: 0, notes: 0, requests: 0, idle: 'waiting', targets: [] });
  const [lastScanAt, setLastScanAt] = useState('');
  const [scanCount, setScanCount] = useState(0);
  const [operationLog, setOperationLog] = useState<string[]>([]);
  void refreshTick;
  const runs = readRunRecords(projectDir);
  const skillStats = getRankedSkillStats(projectDir);
  const registeredSkills = indexSkills(projectDir);
  const history = readHistory(projectDir, 50);
  const eventLog = readEvents(projectDir, 500);
  const injections = listInjections(projectDir, 100);
  const profile = readProjectProfile(projectDir);
  const budget = readTokenBudget();
  const claude = readClaudeCodeStatus(projectDir);
  const codex = readCodexStatus();
  const idleSnapshot = readIdleSchedulerSnapshot(projectDir);
  const laneStats = getLaneStats();
  const provenanceStats = summarizeProvenance(projectDir);
  const successCount = runs.filter((run) => run.success).length;
  const failedCount = runs.length - successCount;
  const warningCount = eventLog.filter((event) => event.severity === 'warning').length;
  const errorCount = eventLog.filter((event) => event.severity === 'error' || event.severity === 'critical').length;
  const proposedInjections = injections.filter((item) => item.state === 'proposed').length;
  const pluginCount = claude.enabledPlugins;
  const skillCount = registeredSkills.length + claude.userComponents.skills + codex.userSkills + codex.systemSkills;
  const memoryCount = claude.projectMemoryFiles + codex.memoryFiles;
  const heartbeat = ['|', '/', '-', '\\'][scanCount % 4];
  const indexes = scoreIndexes({
    events: eventLog,
    histories: history.length,
    runs: runs.length,
    skills: skillCount,
    memories: memoryCount,
  });

  useEffect(() => {
    let stopped = false;
    const refresh = () => {
      try {
        const next = scanAutoAssistantOnce(projectDir, seenRef.current, tmuxSessionName);
        if (stopped) return;
        setScanResult(next);
        setLastScanAt(new Date().toLocaleTimeString());
        setScanCount((count) => count + 1);
        setRefreshTick(Date.now());
        const meaningful = next.signals > 0 || next.requests > 0 || next.notes > 0;
        if (meaningful) {
          setOperationLog((prev) => [
            logLine(`scan panes=${next.panes} signals=${next.signals} requests=${next.requests} idle=${next.idle} notes=${next.notes}`),
            ...prev,
          ].slice(0, 40));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setOperationLog((prev) => [logLine(`scan failed: ${message}`), ...prev].slice(0, 40));
      }
    };
    refresh();
    const id = setInterval(refresh, 3000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [projectDir, tmuxSessionName]);

  const submit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    recordUserRequestPattern(projectDir, trimmed, 'tui');
    recordProvenance(projectDir, { source: 'tui', command: 'submit', sessionId: tmuxSessionName, content: trimmed });
    if (trimmed === '/exit' || trimmed === '/quit') {
      exit();
      return;
    }
    if (trimmed === '/help') {
      setView('help');
      setNotice('showing command help');
      setTask('');
      return;
    }
    if (trimmed === '/status') {
      setView('dashboard');
      setNotice(`calls ${eventLog.length}`);
      setTask('');
      return;
    }
    if (
      trimmed === '/runs' || trimmed === '/skills' || trimmed === '/inbox'
      || trimmed === '/calls' || trimmed === '/audit' || trimmed === '/knowledge'
      || trimmed === '/logs' || trimmed === '/inject'
    ) {
      setView(trimmed.slice(1) as ViewMode);
      setNotice(`view: ${trimmed.slice(1)}`);
      setTask('');
      return;
    }
    if (trimmed === '/scan') {
      const next = scanAutoAssistantOnce(projectDir, seenRef.current, tmuxSessionName);
      setScanResult(next);
      setLastScanAt(new Date().toLocaleTimeString());
      setScanCount((count) => count + 1);
      setRefreshTick(Date.now());
      setOperationLog((prev) => [logLine(`manual scan panes=${next.panes} signals=${next.signals} requests=${next.requests} idle=${next.idle} notes=${next.notes}`), ...prev].slice(0, 40));
      setNotice('scan completed');
      setTask('');
      return;
    }
    if (trimmed.startsWith('/approve ')) {
      const id = trimmed.slice('/approve '.length).trim();
      const approved = approveInjection(projectDir, id);
      setNotice(`${approved.success ? 'approved' : 'blocked'}: ${approved.message}`);
      setView('inject');
      setTask('');
      return;
    }
    if (trimmed.startsWith('/deny ')) {
      const id = trimmed.slice('/deny '.length).trim();
      const denied = denyInjection(projectDir, id);
      setNotice(denied ? 'denied' : 'proposal not found');
      setView('inject');
      setTask('');
      return;
    }
    if (trimmed === '/clear') {
      setOperationLog([]);
      setNotice('transcript cleared');
      setTask('');
      return;
    }

    setTask('');
    setNotice(`unknown command: ${trimmed}`);
  };

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box borderStyle="single" paddingX={1} flexDirection="column">
        <Box justifyContent="space-between">
          <Text bold>overseer TUI</Text>
          <Text color="green">LIVE {heartbeat} scan #{scanCount}</Text>
        </Box>
        <Text color="gray">project: {projectDir}</Text>
        <Text color="gray">tmux session: {tmuxSessionName}</Text>
        <Text color="gray">view: {view} | /help /calls /audit /knowledge /logs /scan /exit</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Box gap={1}>
          <Box borderStyle="single" paddingX={1} flexDirection="column" width="33%">
            <Text bold>Monitor</Text>
            <Text color="green">watching {tmuxSessionName} every 3s</Text>
            <Text color="gray">last scan: {lastScanAt || 'starting'} | {heartbeat}</Text>
            <Text color="gray">panes: {scanResult.panes} | signals: {scanResult.signals}</Text>
            <Text color="gray">requests: {scanResult.requests} | idle: {scanResult.idle}</Text>
            <Text color="gray">last req: {idleSnapshot.lastUserRequestAt?.slice(11, 19) ?? 'none'}</Text>
            <Text color="gray">backlog: {idleSnapshot.openBacklog} | top: {idleSnapshot.topPriority ?? 0}</Text>
            <Text color="gray">calls: {eventLog.length} | warnings: {warningCount}</Text>
            <Text color="gray">lanes: scan {laneStats.scan.active ? 'active' : 'idle'}/{laneStats.scan.queued} run {laneStats.run.active ? 'active' : 'idle'}/{laneStats.run.queued}</Text>
            <Text color="gray">{profile ? `files: ${profile.fileCount}` : 'no profile yet'}</Text>
          </Box>
          <Box borderStyle="single" paddingX={1} flexDirection="column" width="34%">
            <Text bold>Development</Text>
            <Text color="gray">skills: {skillCount} | plugins: {pluginCount}</Text>
            <Text color="gray">memory: {memoryCount} | history: {history.length}</Text>
            <Text color="gray">injections: {proposedInjections} pending</Text>
            <Text color="gray">inputs: tui {provenanceStats.tui} tmux {provenanceStats.tmux} cli {provenanceStats.cli}</Text>
          </Box>
          <Box borderStyle="single" paddingX={1} flexDirection="column" width="33%">
            <Text bold>Indexes</Text>
            <Text color={scoreColor(indexes.audit)}>audit: {indexes.audit}</Text>
            <Text color={scoreColor(indexes.analysis)}>analysis: {indexes.analysis}</Text>
            <Text color={scoreColor(indexes.knowledge)}>knowledge: {indexes.knowledge}</Text>
            <Text color="gray">budget: {budget.maxPromptTokens}/{budget.maxContextTokens}</Text>
            <Text color="gray">waiting</Text>
          </Box>
        </Box>

        <Box borderStyle="single" paddingX={1} flexDirection="column" marginTop={1}>
          <Text bold>{view === 'dashboard' ? 'Monitor' : view[0].toUpperCase() + view.slice(1)}</Text>
          {view === 'dashboard' && (
            <Box flexDirection="column">
              <Text color="gray">calls={eventLog.length} audit={indexes.audit} analysis={indexes.analysis} knowledge={indexes.knowledge}</Text>
              <Text color="gray">direction={truncate(idleSnapshot.direction, 96)}</Text>
              {idleSnapshot.lastUserRequest && <Text color="gray">last request={truncate(idleSnapshot.lastUserRequest, 96)}</Text>}
              {idleSnapshot.topGoal && <Text color="gray">top goal={truncate(idleSnapshot.topGoal, 96)}</Text>}
              {scanResult.targets.length === 0 && <Text color="yellow">target: no Claude/Codex pane detected in this session</Text>}
              {scanResult.targets.slice(0, 3).map((target) => (
                <Text key={`${target.paneId}-${target.command}`} color={target.active ? 'green' : 'gray'}>
                  target {target.paneId} {target.active ? 'active' : 'idle'} cmd={target.command} last={truncate(target.lastLine || target.currentPath, 76)}
                </Text>
              ))}
              {operationLog.slice(0, 6).map((line, index) => (
                <Text key={`${line}-${index}`} color="gray">{truncate(line, 110)}</Text>
              ))}
              {eventLog.slice(-6).reverse().map((event) => (
                <Text key={event.id} color={event.severity === 'info' ? 'cyan' : event.severity === 'warning' ? 'yellow' : 'red'}>
                  {event.timestamp.slice(11, 19)} [{event.severity}] {truncate(event.type, 32)} {event.provenance.command ?? event.provenance.source}
                </Text>
              ))}
            </Box>
          )}
          {view === 'calls' && eventLog.slice(-16).reverse().map((event) => (
            <Text key={event.id} color={event.severity === 'info' ? 'cyan' : event.severity === 'warning' ? 'yellow' : 'red'}>
              {event.timestamp.slice(0, 19)} {event.type} src={event.provenance.source}{event.provenance.command ? ` cmd=${event.provenance.command}` : ''}
            </Text>
          ))}
          {view === 'audit' && (
            <Box flexDirection="column">
              <Text color={scoreColor(indexes.audit)}>audit index: {indexes.audit}</Text>
              <Text color="yellow">warnings: {warningCount} | errors: {errorCount}</Text>
              <Text color="gray">pending injections: {proposedInjections}</Text>
              {eventLog.filter((event) => event.severity !== 'info').slice(-10).reverse().map((event) => (
                <Text key={event.id} color={event.severity === 'warning' ? 'yellow' : 'red'}>
                  {event.timestamp.slice(0, 19)} {event.type} {truncate(JSON.stringify(event.payload), 90)}
                </Text>
              ))}
            </Box>
          )}
          {view === 'knowledge' && (
            <Box flexDirection="column">
              <Text color={scoreColor(indexes.knowledge)}>knowledge index: {indexes.knowledge}</Text>
              <Text color="gray">skills: local {registeredSkills.length}, claude {claude.userComponents.skills}, codex {codex.userSkills + codex.systemSkills}</Text>
              <Text color="gray">memory: claude {claude.projectMemoryFiles}, codex {codex.memoryFiles}</Text>
              <Text color="gray">patterns/history: {history.length} | project files: {profile?.fileCount ?? 0}</Text>
              <Text color="gray">direction: {truncate(idleSnapshot.direction, 100)}</Text>
              <Text color="gray">idle backlog: {idleSnapshot.openBacklog} | last: {idleSnapshot.lastScheduledAt?.slice(0, 19) ?? 'none'}</Text>
              {history.slice(-8).reverse().map((item) => (
                <Text key={item.id} color="cyan">[{item.kind}] {truncate(item.title, 90)}</Text>
              ))}
            </Box>
          )}
          {view === 'logs' && operationLog.slice(0, 18).map((line, index) => (
            <Text key={`${line}-${index}`} color="gray">{truncate(line, 120)}</Text>
          ))}
          {view === 'runs' && runs.slice(-10).reverse().map((run) => (
            <Text key={run.id} color={run.success ? 'green' : 'red'}>
              {run.success ? '+' : 'x'} {run.timestamp.slice(0, 19)} {truncate(run.task, 86)}
            </Text>
          ))}
          {view === 'skills' && skillStats.slice(0, 12).map((skill) => (
            <Text key={skill.name} color={skill.disabled ? 'red' : skill.score >= 0.7 ? 'green' : 'yellow'}>
              {skill.disabled ? 'x' : '+'} {skill.name} score={skill.score.toFixed(2)} runs={skill.runs} failures={skill.failures}
            </Text>
          ))}
          {view === 'inbox' && history.slice().reverse().map((item) => (
            <Text key={item.id} color="cyan">
              [{item.kind}] {truncate(item.title, 28)} - {truncate(item.detail, 80)}
            </Text>
          ))}
          {view === 'inject' && injections.slice(-12).reverse().map((item) => (
            <Text key={`${item.id}-${item.updatedAt}`} color={item.state === 'proposed' ? 'yellow' : item.state === 'sent' ? 'green' : 'gray'}>
              {item.id} [{item.state}] risk={item.risk.level} pane={item.paneId} {truncate(item.reason, 70)}
            </Text>
          ))}
          {view === 'help' && (
            <Box flexDirection="column">
              <Text color="cyan">Single-entry TUI: monitor, inspect, and command from here.</Text>
              <Text>/status  Show dashboard</Text>
              <Text>/calls   Show call/event log</Text>
              <Text>/audit   Show audit index and risks</Text>
              <Text>/knowledge Show development pattern and knowledge state</Text>
              <Text>/logs    Show assistant operation log</Text>
              <Text>/inbox   Show monitoring and learning history</Text>
              <Text>/inject  Show injection proposals</Text>
              <Text>/approve &lt;id&gt; Approve injection proposal</Text>
              <Text>/deny &lt;id&gt; Deny injection proposal</Text>
              <Text>/scan    Run monitor scan now</Text>
              <Text>/runs    Show recent runs</Text>
              <Text>/skills  Show skill scores and disabled status</Text>
              <Text>/clear   Clear current screen log</Text>
              <Text>/exit    Exit</Text>
            </Box>
          )}
          {view !== 'help' && eventLog.length === 0 && runs.length === 0 && operationLog.length === 0 && <Text color="gray">no activity yet</Text>}
        </Box>

      </Box>

      <Box marginTop={1} borderStyle="single" paddingX={1}>
        <Text color="green">manage &gt; </Text>
        <TextInput value={task} onChange={setTask} onSubmit={submit} />
      </Box>
      <Text color="gray">{notice}</Text>
    </Box>
  );
}

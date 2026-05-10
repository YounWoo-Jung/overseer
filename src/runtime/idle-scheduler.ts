import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { readEvents, recordEvent } from '../state/event-store.js';
import { appendAssist } from '../state/history-store.js';
import { approveInjection, proposeInjection } from './injector.js';
import { loadAssistantConfig } from './config.js';
import { compactText } from './token-budget.js';
import { redactSecrets } from './redact.js';
import { recordProvenance } from './provenance.js';
import type { TmuxPaneSnapshot } from './tmux.js';

type AiKind = 'claude' | 'codex';
type RequestSource = 'tui' | 'tmux';

interface RequestPatternState {
  updatedAt: string;
  lastUserRequestAt?: string;
  lastUserRequest?: string;
  requestCount: number;
  topics: Record<string, number>;
  commands: Record<string, number>;
  seenRequestHashes: string[];
  lastScheduledAt?: string;
  lastScheduledCommand?: string;
}

type BacklogState = 'open' | 'scheduled';

interface BacklogItem {
  id: string;
  title: string;
  priority: number;
  reason: string;
  source: string;
  state: BacklogState;
  createdAt: string;
  updatedAt: string;
  scheduledAt?: string;
}

export interface IdleSchedulerResult {
  state: 'disabled' | 'waiting' | 'cooldown' | 'busy' | 'no-target' | 'proposed' | 'sent' | 'blocked';
  idleMs: number;
  command?: string;
  target?: string;
  goal?: string;
  priority?: number;
  message?: string;
}

export interface IdleSchedulerSnapshot {
  requestCount: number;
  lastUserRequestAt?: string;
  lastUserRequest?: string;
  lastScheduledAt?: string;
  lastScheduledCommand?: string;
  direction: string;
  openBacklog: number;
  topGoal?: string;
  topPriority?: number;
}

const STATE_FILE = '.overseer/request-patterns.json';
const MARKDOWN_FILE = '.overseer/request-patterns.md';
const BACKLOG_FILE = '.overseer/backlog.json';
const MAX_HASHES = 200;

const TOPIC_RULES: { topic: string; pattern: RegExp }[] = [
  { topic: 'DDD', pattern: /\bDDD\b|domain|도메인/i },
  { topic: 'SDD', pattern: /\bSDD\b|spec|specification|명세/i },
  { topic: 'TDD', pattern: /\bTDD\b|test|테스트/i },
  { topic: 'Agentic Development', pattern: /agentic|agent|에이전트/i },
  { topic: 'Context Engineering', pattern: /context|컨텍스트|memory|메모리/i },
  { topic: 'MVP', pattern: /\bMVP\b|minimal|최소/i },
  { topic: 'Product Completeness', pattern: /완성도|quality|안정성|polish|제품/i },
  { topic: 'Scheduler', pattern: /schedule|scheduler|idle|스케줄|유휴/i },
  { topic: 'tmux Session', pattern: /tmux|session|pane|세션/i },
  { topic: 'Claude Code', pattern: /claude/i },
  { topic: 'Codex', pattern: /codex/i },
];

export function readIdleSchedulerSnapshot(projectDir: string): IdleSchedulerSnapshot {
  const state = readState(projectDir);
  const backlog = readBacklog(projectDir);
  const open = backlog.items.filter((item) => item.state === 'open').sort(sortBacklog);
  return {
    requestCount: state.requestCount,
    lastUserRequestAt: state.lastUserRequestAt,
    lastUserRequest: state.lastUserRequest,
    lastScheduledAt: state.lastScheduledAt,
    lastScheduledCommand: state.lastScheduledCommand,
    direction: summarizeDirection(state),
    openBacklog: open.length,
    topGoal: open[0]?.title,
    topPriority: open[0]?.priority,
  };
}

export function recordUserRequestPattern(projectDir: string, request: string, source: RequestSource): void {
  const text = redactSecrets(request.trim());
  if (!text) return;
  recordProvenance(projectDir, { source, content: text });
  const state = readState(projectDir);
  applyRequest(state, text, source);
  writeState(projectDir, state);
}

export function observeSessionRequestPatterns(projectDir: string, panes: TmuxPaneSnapshot[]): number {
  const state = readState(projectDir);
  let observed = 0;
  for (const pane of panes) {
    for (const request of extractRequestLines(pane.content)) {
      const hash = hashText(`${pane.paneId}:${request}`);
      if (state.seenRequestHashes.includes(hash)) continue;
      state.seenRequestHashes.push(hash);
      recordProvenance(projectDir, { source: 'tmux', sessionId: pane.sessionName, paneId: pane.paneId, command: pane.currentCommand, content: request });
      applyRequest(state, request, 'tmux');
      observed += 1;
    }
  }
  if (observed > 0) {
    state.seenRequestHashes = state.seenRequestHashes.slice(-MAX_HASHES);
    writeState(projectDir, state);
  }
  return observed;
}

export function maybeScheduleIdleDevelopment(projectDir: string, panes: TmuxPaneSnapshot[]): IdleSchedulerResult {
  const config = loadAssistantConfig(projectDir);
  const state = readState(projectDir);
  if (!config.idleSchedulerEnabled) return { state: 'disabled', idleMs: 0 };
  if (!state.lastUserRequestAt) return { state: 'waiting', idleMs: 0, message: 'no request pattern yet' };

  const now = Date.now();
  const lastRequest = Date.parse(state.lastUserRequestAt);
  const idleMs = Number.isFinite(lastRequest) ? now - lastRequest : 0;
  if (idleMs < config.idleThresholdMs) return { state: 'waiting', idleMs };

  const target = selectTargetPane(panes);
  if (!target) {
    state.lastScheduledAt = new Date(now).toISOString();
    writeState(projectDir, state);
    recordEvent(projectDir, {
      type: 'scheduler.idle.no_target',
      severity: 'info',
      provenance: { source: 'system' },
      payload: { idleMs },
    });
    return { state: 'no-target', idleMs, message: 'no Claude/Codex pane' };
  }

  if (config.allowedSessions.length > 0 && !config.allowedSessions.includes(target.pane.sessionName)) {
    state.lastScheduledAt = new Date(now).toISOString();
    writeState(projectDir, state);
    recordEvent(projectDir, {
      type: 'scheduler.idle.blocked',
      severity: 'warning',
      provenance: { source: 'system', sessionId: target.pane.sessionName, paneId: target.pane.paneId },
      payload: { idleMs, reason: 'session not allowed' },
    });
    return { state: 'blocked', idleMs, target: target.pane.paneId, message: 'session not allowed' };
  }

  if (isPaneBusy(target.pane)) {
    return { state: 'busy', idleMs, target: target.pane.paneId, message: 'target pane is busy' };
  }

  const lastScheduled = state.lastScheduledAt ? Date.parse(state.lastScheduledAt) : 0;
  if (lastScheduled && now - lastScheduled < config.idleSchedulerIntervalMs) {
    return { state: 'cooldown', idleMs };
  }

  const selected = refreshBacklog(projectDir, state);

  const command = target.kind === 'claude' ? '/loop' : '/goal';
  const message = buildIdleCommand(command, state, selected);
  const proposal = proposeInjection(projectDir, {
    paneId: target.pane.paneId,
    sessionName: target.pane.sessionName,
    message,
    reason: `idle scheduler: ${Math.floor(idleMs / 60000)}m idle | ${selected.title}`,
    dedupKey: hashText(`idle:${target.pane.paneId}:${command}:${selected.id}:${state.lastUserRequestAt}`),
  });

  state.lastScheduledAt = new Date(now).toISOString();
  state.lastScheduledCommand = command;
  markBacklogScheduled(projectDir, selected.id, state.lastScheduledAt);
  writeState(projectDir, state);

  if (!proposal) return { state: 'cooldown', idleMs, command, target: target.pane.paneId, goal: selected.title, priority: selected.priority };

  appendAssist(projectDir, 'idle scheduler', [
    `Target: ${target.kind} ${target.pane.paneId}`,
    `Command: ${command}`,
    `Goal: ${selected.title}`,
    `Priority: ${selected.priority}`,
    `Idle: ${Math.floor(idleMs / 60000)}m`,
    `Direction: ${summarizeDirection(state)}`,
  ]);
  recordEvent(projectDir, {
    type: 'scheduler.idle.selected',
    severity: 'info',
    provenance: { source: 'system', sessionId: target.pane.sessionName, paneId: target.pane.paneId, command },
    payload: { goal: selected.title, priority: selected.priority, reason: selected.reason, idleMs },
  });

  if (!config.injectEnabled) {
    return { state: 'proposed', idleMs, command, target: target.pane.paneId, goal: selected.title, priority: selected.priority };
  }

  const sent = approveInjection(projectDir, proposal.id);
  return {
    state: sent.success ? 'sent' : 'blocked',
    idleMs,
    command,
    target: target.pane.paneId,
    goal: selected.title,
    priority: selected.priority,
    message: sent.message,
  };
}

function applyRequest(state: RequestPatternState, request: string, source: RequestSource): void {
  state.updatedAt = new Date().toISOString();
  state.lastUserRequestAt = state.updatedAt;
  state.lastUserRequest = compactText(request, 300, 'tail');
  state.requestCount += 1;
  const command = request.match(/^\/([a-z][\w-]*)/i)?.[1] ?? source;
  state.commands[command] = (state.commands[command] ?? 0) + 1;
  for (const topic of classifyTopics(request)) {
    state.topics[topic] = (state.topics[topic] ?? 0) + 1;
  }
}

function classifyTopics(text: string): string[] {
  return TOPIC_RULES.filter((rule) => rule.pattern.test(text)).map((rule) => rule.topic);
}

function extractRequestLines(content: string): string[] {
  const lines = content.split('\n').map((line) => line.trim()).filter(Boolean).slice(-120);
  const requests: string[] = [];
  for (const line of lines) {
    const prefixed = line.match(/^(?:user|human|사용자|요청)\s*[:>]\s*(.+)$/i)?.[1];
    const promptInput = line.match(/^[❯›]\s*(.+)$/u)?.[1];
    const candidate = prefixed ?? promptInput ?? (/^\/(?:goal|loop|run)\b/i.test(line) ? line : '');
    if (candidate && looksLikeRequest(candidate)) requests.push(redactSecrets(candidate).slice(0, 400));
  }
  return requests.slice(-8);
}

function looksLikeRequest(text: string): boolean {
  const normalized = text.trim();
  if (/^find and fix a bug in @filename$/i.test(normalized)) return false;
  if (/^(ok|okay|yes|y|go|start|proceed|진행|진행\s*오케이|오케이|시작|해|응|ㅇㅇ)$/i.test(normalized)) return true;
  return normalized.length >= 6 && /(fix|add|remove|update|create|implement|test|goal|loop|수정|추가|삭제|정리|구현|테스트|확인|봐줘|띄워|만들|해줘|고쳐|보여|찾아|진행|시작|방향성)/i.test(normalized);
}

function isPaneBusy(pane: TmuxPaneSnapshot): boolean {
  const tail = pane.content.split('\n').slice(-40).join('\n');
  return /(Working|Running|Reticulating|Herding|thinking|esc to interrupt|◼|중…)/i.test(tail);
}

function selectTargetPane(panes: TmuxPaneSnapshot[]): { kind: AiKind; pane: TmuxPaneSnapshot } | null {
  const candidates = panes
    .map((pane) => ({ kind: inferAiKind(pane), pane }))
    .filter((item): item is { kind: AiKind; pane: TmuxPaneSnapshot } => Boolean(item.kind));
  return candidates.find((item) => item.pane.active) ?? candidates[0] ?? null;
}

function inferAiKind(pane: TmuxPaneSnapshot): AiKind | null {
  const command = pane.currentCommand.toLowerCase();
  const text = pane.content.toLowerCase();
  if (command.includes('claude') || /^claude(\s|$)/.test(text)) return 'claude';
  if (command.includes('codex') || /^codex(\s|$)/.test(text) || /\/bin\/codex\b|@openai\/codex/.test(text)) return 'codex';
  return null;
}

function buildIdleCommand(command: '/loop' | '/goal', state: RequestPatternState, item: BacklogItem): string {
  const last = compactText(state.lastUserRequest ?? '', 180, 'tail').replace(/\s+/g, ' ');
  return [
    command,
    `제품 완성도 작업 1개만 진행해줘: ${item.title}.`,
    `선정 이유: ${item.reason}.`,
    `개발 방향: ${summarizeDirection(state)}.`,
    last ? `마지막 요청: ${last}.` : '',
    '작업 계약: Domain 영향 범위 1줄, Spec/완료 조건 2개, 최소 테스트 1개를 먼저 정해.',
    'DDD/SDD/TDD/Agentic Development/Context Engineering 기준으로 작은 변경만 해.',
    '작업이 커지면 중단하고 더 작은 목표로 재분해해.',
    'Implement-Test-Fix 루프 후 변경 파일, 검증 결과, 남은 리스크만 짧게 보고해줘.',
  ].filter(Boolean).join(' ');
}

function readState(projectDir: string): RequestPatternState {
  const path = statePath(projectDir);
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<RequestPatternState>;
    return {
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
      lastUserRequestAt: parsed.lastUserRequestAt,
      lastUserRequest: parsed.lastUserRequest,
      requestCount: parsed.requestCount ?? 0,
      topics: parsed.topics ?? {},
      commands: parsed.commands ?? {},
      seenRequestHashes: parsed.seenRequestHashes ?? [],
      lastScheduledAt: parsed.lastScheduledAt,
      lastScheduledCommand: parsed.lastScheduledCommand,
    };
  } catch {
    return {
      updatedAt: new Date().toISOString(),
      requestCount: 0,
      topics: {},
      commands: {},
      seenRequestHashes: [],
    };
  }
}

function writeState(projectDir: string, state: RequestPatternState): void {
  const jsonPath = statePath(projectDir);
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(state, null, 2)}\n`);
  writeFileSync(markdownPath(projectDir), renderMarkdown(state));
}

function refreshBacklog(projectDir: string, state: RequestPatternState): BacklogItem {
  const backlog = readBacklog(projectDir);
  for (const item of deriveBacklogItems(projectDir, state)) {
    const existing = backlog.items.find((candidate) => candidate.id === item.id);
    if (existing) continue;
    backlog.items.push(item);
  }
  const open = backlog.items.filter((item) => item.state === 'open');
  if (open.length === 0) {
    const item = makeBacklogItem(
      '문서와 런타임 상태의 개발 방향성 불일치 1개 정리',
      40,
      '반복 요청 패턴을 컨텍스트에 반영해 제품 방향성을 유지',
      'default'
    );
    if (!backlog.items.some((candidate) => candidate.id === item.id)) backlog.items.push(item);
  }
  writeBacklog(projectDir, backlog);
  return selectBacklogItem(backlog);
}

function deriveBacklogItems(projectDir: string, state: RequestPatternState): BacklogItem[] {
  const events = readEvents(projectDir, 100);
  const items: BacklogItem[] = [];
  if (events.some((event) => event.type === 'failure.detected')) {
    items.push(makeBacklogItem('최근 실패 로그의 첫 원인 기준으로 검증 실패 수정', 100, '실패 테스트나 빌드는 제품 완성도 최우선 항목', 'event:failure'));
  }
  if (events.some((event) => event.type === 'type_error.detected')) {
    items.push(makeBacklogItem('최근 타입 오류의 정의부와 호출부를 함께 수정', 90, '타입 오류는 후속 자동 작업을 막는 직접 원인', 'event:type'));
  }
  if (events.some((event) => event.severity === 'warning' && /config|risk|permission/i.test(event.type))) {
    items.push(makeBacklogItem('최근 설정 경고 1개를 문서 또는 기본값과 맞추기', 80, '설정 위험은 자동 실행 신뢰도를 낮춤', 'event:risk'));
  }
  if ((state.topics['Context Engineering'] ?? 0) > 0) {
    items.push(makeBacklogItem('요청 패턴과 메모리 컨텍스트 불일치 1개 정리', 60, 'Context Engineering 요청 빈도가 높음', 'pattern:context'));
  }
  if ((state.topics.TDD ?? 0) > 0) {
    items.push(makeBacklogItem('현재 변경 범위에 맞는 최소 검증 경로 보강', 55, 'TDD 요청 빈도가 높음', 'pattern:tdd'));
  }
  if ((state.topics['Product Completeness'] ?? 0) > 0) {
    items.push(makeBacklogItem('TUI 또는 README의 제품 완성도 누락 1개 보완', 50, '제품 완성도 요청 빈도가 높음', 'pattern:quality'));
  }
  return items;
}

function makeBacklogItem(title: string, priority: number, reason: string, source: string): BacklogItem {
  const now = new Date().toISOString();
  return {
    id: `backlog-${hashText(`${source}:${title}`)}`,
    title,
    priority,
    reason,
    source,
    state: 'open',
    createdAt: now,
    updatedAt: now,
  };
}

function selectBacklogItem(backlog: { items: BacklogItem[] }): BacklogItem {
  const open = backlog.items.filter((item) => item.state === 'open').sort(sortBacklog);
  return open[0] ?? makeBacklogItem('문서와 런타임 상태의 개발 방향성 불일치 1개 정리', 40, '열린 backlog가 없어 기본 완성도 작업 선택', 'default:fallback');
}

function markBacklogScheduled(projectDir: string, id: string, scheduledAt: string): void {
  const backlog = readBacklog(projectDir);
  const item = backlog.items.find((candidate) => candidate.id === id);
  if (!item) return;
  item.state = 'scheduled';
  item.scheduledAt = scheduledAt;
  item.updatedAt = scheduledAt;
  writeBacklog(projectDir, backlog);
}

function readBacklog(projectDir: string): { updatedAt: string; items: BacklogItem[] } {
  try {
    const parsed = JSON.parse(readFileSync(backlogPath(projectDir), 'utf-8')) as { updatedAt?: string; items?: BacklogItem[] };
    return {
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
      items: Array.isArray(parsed.items) ? parsed.items : [],
    };
  } catch {
    return { updatedAt: new Date().toISOString(), items: [] };
  }
}

function writeBacklog(projectDir: string, backlog: { updatedAt: string; items: BacklogItem[] }): void {
  const path = backlogPath(projectDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ ...backlog, updatedAt: new Date().toISOString() }, null, 2)}\n`);
}

function renderMarkdown(state: RequestPatternState): string {
  return [
    '# 사용자 요청 패턴',
    '',
    `- 업데이트: ${state.updatedAt}`,
    `- 마지막 요청: ${state.lastUserRequestAt ?? '없음'}`,
    `- 요청 수: ${state.requestCount}`,
    `- 마지막 스케줄: ${state.lastScheduledAt ?? '없음'}${state.lastScheduledCommand ? ` (${state.lastScheduledCommand})` : ''}`,
    `- 개발 방향: ${summarizeDirection(state)}`,
    '',
    '## 상위 주제',
    ...topEntries(state.topics, 8).map(([topic, count]) => `- ${topic}: ${count}`),
    '',
    '## 상위 명령',
    ...topEntries(state.commands, 8).map(([command, count]) => `- ${command}: ${count}`),
    '',
    '## 최근 요청',
    state.lastUserRequest ? `- ${state.lastUserRequest}` : '- 없음',
    '',
  ].join('\n');
}

function summarizeDirection(state: RequestPatternState): string {
  const topics = topKeys(state.topics, 5);
  const commands = topKeys(state.commands, 3);
  const parts = [
    topics.includes('MVP') ? 'MVP 우선' : '',
    topics.includes('TDD') ? '검증 먼저' : '',
    topics.includes('Context Engineering') ? '컨텍스트 최신화' : '',
    topics.includes('Agentic Development') ? '감시-실행-검증 루프' : '',
    topics.includes('Product Completeness') ? '제품 완성도 개선' : '',
  ].filter(Boolean);
  const base = parts.length ? parts.join(', ') : '작은 변경과 안정성 우선';
  return commands.length ? `${base}; 주요 명령 ${commands.join(', ')}` : base;
}

function sortBacklog(a: BacklogItem, b: BacklogItem): number {
  return b.priority - a.priority || a.createdAt.localeCompare(b.createdAt);
}

function topKeys(values: Record<string, number>, limit: number): string[] {
  return topEntries(values, limit).map(([key]) => key);
}

function topEntries(values: Record<string, number>, limit: number): [string, number][] {
  return Object.entries(values).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
}

function statePath(projectDir: string): string {
  return join(resolve(projectDir), STATE_FILE);
}

function markdownPath(projectDir: string): string {
  return join(resolve(projectDir), MARKDOWN_FILE);
}

function backlogPath(projectDir: string): string {
  return join(resolve(projectDir), BACKLOG_FILE);
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

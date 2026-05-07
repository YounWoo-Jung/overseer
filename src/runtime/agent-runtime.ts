import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { runAutonomousTask } from '../orchestrator.js';
import type { RunResult } from '../types.js';
import { observeProject } from './observer.js';
import { loadAssistantConfig } from './config.js';
import { recordEvent } from '../state/event-store.js';

const STATE_DIR = '.overseer';
const QUEUE_DIR = 'queue';
const RUNNING_DIR = 'running';
const RESULTS_DIR = 'results';
const STATUS_FILE = 'agent-status.json';

export type AgentJobState = 'queued' | 'running' | 'done' | 'failed';

export interface AgentJob {
  id: string;
  task: string;
  projectDir: string;
  maxIterations?: number;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  state: AgentJobState;
}

export interface AgentJobResult {
  job: AgentJob;
  result?: RunResult;
  error?: string;
}

export interface AgentStatus {
  pid: number;
  projectDir: string;
  state: 'starting' | 'idle' | 'running' | 'stopped';
  currentJobId?: string;
  argv?: string[];
  startTime?: number | null;
  updatedAt: string;
}

function stateDir(projectDir: string): string {
  return join(resolve(projectDir), STATE_DIR);
}

function dir(projectDir: string, name: string): string {
  return join(stateDir(projectDir), name);
}

function ensureAgentState(projectDir: string): void {
  mkdirSync(dir(projectDir, QUEUE_DIR), { recursive: true });
  mkdirSync(dir(projectDir, RUNNING_DIR), { recursive: true });
  mkdirSync(dir(projectDir, RESULTS_DIR), { recursive: true });
}

function safeReadJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function jobFile(projectDir: string, state: AgentJobState, id: string): string {
  const folder = state === 'queued' ? QUEUE_DIR : state === 'running' ? RUNNING_DIR : RESULTS_DIR;
  return join(dir(projectDir, folder), `${id}.json`);
}

function makeJobId(): string {
  return `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function submitAgentJob(projectDir: string, task: string, maxIterations?: number): AgentJob {
  const root = resolve(projectDir);
  ensureAgentState(root);
  const job: AgentJob = {
    id: makeJobId(),
    task,
    projectDir: root,
    maxIterations,
    createdAt: new Date().toISOString(),
    state: 'queued',
  };
  writeJson(jobFile(root, 'queued', job.id), job);
  recordEvent(root, {
    type: 'queue.submitted',
    severity: 'info',
    provenance: { source: 'user' },
    payload: { jobId: job.id, task },
  });
  return job;
}

export function readAgentStatus(projectDir: string): AgentStatus | null {
  const path = join(stateDir(projectDir), STATUS_FILE);
  if (!existsSync(path)) return null;
  return safeReadJson<AgentStatus>(path);
}

export function listAgentJobs(projectDir: string): AgentJobResult[] {
  ensureAgentState(projectDir);
  const items: AgentJobResult[] = [];
  for (const state of ['queued', 'running'] as const) {
    for (const path of readdirJson(dir(projectDir, state === 'queued' ? QUEUE_DIR : RUNNING_DIR))) {
      const job = safeReadJson<AgentJob>(path);
      if (job) items.push({ job: { ...job, state } });
    }
  }
  for (const path of readdirJson(dir(projectDir, RESULTS_DIR))) {
    const result = safeReadJson<AgentJobResult>(path);
    if (result?.job) items.push(result);
  }
  return items.sort((a, b) => a.job.createdAt.localeCompare(b.job.createdAt));
}

function readdirJson(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path).filter((name) => name.endsWith('.json')).sort().map((name) => join(path, name));
}

function writeStatus(projectDir: string, status: Omit<AgentStatus, 'pid' | 'projectDir' | 'updatedAt'>): void {
  ensureAgentState(projectDir);
  writeJson(join(stateDir(projectDir), STATUS_FILE), {
    pid: process.pid,
    projectDir: resolve(projectDir),
    argv: process.argv,
    startTime: getProcessStartTime(process.pid),
    updatedAt: new Date().toISOString(),
    ...status,
  });
}

function queuedJobPaths(projectDir: string): string[] {
  return readdirJson(dir(projectDir, QUEUE_DIR));
}

async function runJob(projectDir: string, queuedPath: string, onLog?: (message: string) => void): Promise<void> {
  const loaded = safeReadJson<AgentJob>(queuedPath);
  if (!loaded?.task) {
    unlinkSync(queuedPath);
    return;
  }

  const id = loaded.id || basename(queuedPath, '.json');
  const runningPath = jobFile(projectDir, 'running', id);
  const job: AgentJob = {
    ...loaded,
    id,
    projectDir: resolve(loaded.projectDir || projectDir),
    startedAt: new Date().toISOString(),
    state: 'running',
  };
  writeJson(queuedPath, job);
  renameSync(queuedPath, runningPath);
  writeStatus(projectDir, { state: 'running', currentJobId: id });
  onLog?.(`job started: ${job.task}`);

  try {
    const result = await runAutonomousTask({
      task: job.task,
      projectDir: job.projectDir,
      maxIterations: job.maxIterations,
      onEvent: (event) => onLog?.(`[${event.phase}] ${event.message}`),
    });
    const finished: AgentJob = {
      ...job,
      state: result.success ? 'done' : 'failed',
      finishedAt: new Date().toISOString(),
    };
    writeJson(jobFile(projectDir, finished.state, id), { job: finished, result });
    onLog?.(`job ${finished.state}: ${job.task}`);
  } catch (error) {
    const finished: AgentJob = {
      ...job,
      state: 'failed',
      finishedAt: new Date().toISOString(),
    };
    writeJson(jobFile(projectDir, 'failed', id), {
      job: finished,
      error: error instanceof Error ? error.message : String(error),
    });
    onLog?.(`job failed: ${finished.task}`);
  } finally {
    if (existsSync(runningPath)) unlinkSync(runningPath);
    writeStatus(projectDir, { state: 'idle' });
  }
}

export async function runAgentRuntime(input: {
  projectDir: string;
  once?: boolean;
  pollIntervalMs?: number;
  observeIntervalMs?: number;
  onLog?: (message: string) => void;
  shouldStop?: () => boolean;
}): Promise<void> {
  const root = resolve(input.projectDir);
  const config = loadAssistantConfig(root);
  const pollIntervalMs = input.pollIntervalMs ?? 1500;
  const observeIntervalMs = input.observeIntervalMs ?? Math.max(5000, config.watchIntervalMs * 2);
  let lastObserved = 0;
  ensureAgentState(root);
  writeStatus(root, { state: 'starting' });
  recordEvent(root, {
    type: 'daemon.started',
    severity: 'info',
    provenance: { source: 'daemon' },
    payload: { pid: process.pid },
  });
  input.onLog?.(`agent started: ${root}`);

  while (!input.shouldStop?.()) {
    const pending = queuedJobPaths(root);
    if (pending.length === 0) {
      if (Date.now() - lastObserved > observeIntervalMs) {
        lastObserved = Date.now();
        await observeProject(root, { onLog: input.onLog });
      }
      writeStatus(root, { state: 'idle' });
      if (input.once) break;
      await new Promise((resolveTimer) => setTimeout(resolveTimer, pollIntervalMs));
      continue;
    }

    for (const path of pending) {
      if (input.shouldStop?.()) break;
      await runJob(root, path, input.onLog);
    }
    if (input.once) break;
  }

  writeStatus(root, { state: 'stopped' });
  recordEvent(root, {
    type: 'daemon.stopped',
    severity: 'info',
    provenance: { source: 'daemon' },
    payload: { pid: process.pid },
  });
  input.onLog?.('agent stopped');
}

function getProcessStartTime(pid: number): number | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf-8').split(' ');
    return Number(stat[21]) || null;
  } catch {
    return null;
  }
}

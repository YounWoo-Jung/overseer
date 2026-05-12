import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface AssistantConfig {
  maxCaptureLines: number;
  watchIntervalMs: number;
  injectEnabled: boolean;
  injectCooldownMs: number;
  idleSchedulerEnabled: boolean;
  idleThresholdMs: number;
  idleSchedulerIntervalMs: number;
  allowedSessions: string[];
  idleAutopilotEnabled: boolean;
  idleAutopilotThresholdMs: number;
  idleAutopilotCooldownMs: number;
}

const DEFAULT_CONFIG: AssistantConfig = {
  maxCaptureLines: 200,
  watchIntervalMs: 5000,
  injectEnabled: true,
  injectCooldownMs: 120_000,
  idleSchedulerEnabled: true,
  idleThresholdMs: 600_000,
  idleSchedulerIntervalMs: 600_000,
  allowedSessions: [],
  idleAutopilotEnabled: true,
  idleAutopilotThresholdMs: 600_000,
  idleAutopilotCooldownMs: 1_200_000,
};

export function loadAssistantConfig(projectDir: string): AssistantConfig {
  const root = resolve(projectDir);
  const candidates = [
    join(root, 'overseer.config.json'),
    join(root, '.overseer', 'config.json'),
  ];
  const fileConfig = candidates
    .map((path) => existsSync(path) ? readConfigFile(path) : null)
    .find((config): config is Partial<AssistantConfig> => Boolean(config)) ?? {};

  return {
    maxCaptureLines: readNumber('OVERSEER_MAX_CAPTURE_LINES', fileConfig.maxCaptureLines, DEFAULT_CONFIG.maxCaptureLines),
    watchIntervalMs: readNumber('OVERSEER_WATCH_INTERVAL_MS', fileConfig.watchIntervalMs, DEFAULT_CONFIG.watchIntervalMs),
    injectEnabled: readBool('OVERSEER_INJECT_ENABLED', fileConfig.injectEnabled, DEFAULT_CONFIG.injectEnabled),
    injectCooldownMs: readNumber('OVERSEER_INJECT_COOLDOWN_MS', fileConfig.injectCooldownMs, DEFAULT_CONFIG.injectCooldownMs),
    idleSchedulerEnabled: readBool('OVERSEER_IDLE_SCHEDULER_ENABLED', fileConfig.idleSchedulerEnabled, DEFAULT_CONFIG.idleSchedulerEnabled),
    idleThresholdMs: readNumber('OVERSEER_IDLE_THRESHOLD_MS', fileConfig.idleThresholdMs, DEFAULT_CONFIG.idleThresholdMs),
    idleSchedulerIntervalMs: readNumber('OVERSEER_IDLE_SCHEDULER_INTERVAL_MS', fileConfig.idleSchedulerIntervalMs, DEFAULT_CONFIG.idleSchedulerIntervalMs),
    allowedSessions: readList('OVERSEER_ALLOWED_SESSIONS', fileConfig.allowedSessions, DEFAULT_CONFIG.allowedSessions),
    idleAutopilotEnabled: readBool('OVERSEER_IDLE_AUTOPILOT_ENABLED', fileConfig.idleAutopilotEnabled, DEFAULT_CONFIG.idleAutopilotEnabled),
    idleAutopilotThresholdMs: readNumber('OVERSEER_IDLE_AUTOPILOT_THRESHOLD_MS', fileConfig.idleAutopilotThresholdMs, DEFAULT_CONFIG.idleAutopilotThresholdMs),
    idleAutopilotCooldownMs: readNumber('OVERSEER_IDLE_AUTOPILOT_COOLDOWN_MS', fileConfig.idleAutopilotCooldownMs, DEFAULT_CONFIG.idleAutopilotCooldownMs),
  };
}

function readConfigFile(path: string): Partial<AssistantConfig> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Partial<AssistantConfig>;
  } catch {
    return null;
  }
}

function readNumber(name: string, value: number | undefined, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number(raw) : value;
  return Number.isFinite(parsed) && Number(parsed) > 0 ? Math.floor(Number(parsed)) : fallback;
}

function readBool(name: string, value: boolean | undefined, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return value ?? fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function readList(name: string, value: string[] | undefined, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw) return Array.isArray(value) ? value : fallback;
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

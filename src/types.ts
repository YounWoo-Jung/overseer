export type AgentPhase =
  | 'context'
  | 'plan'
  | 'implement'
  | 'validate'
  | 'debug'
  | 'review'
  | 'learn'
  | 'done';

export interface AgentEvent {
  phase: AgentPhase;
  message: string;
  success?: boolean;
  detail?: string;
  timestamp: string;
}

export interface ProjectContext {
  projectDir: string;
  instructions: string;
  memory: string;
  summary: string;
  mistakes: string;
  learning: string;
  skills: { name: string; content: string }[];
  referencedFiles?: FileSnapshot[];
  contextWarnings?: string[];
}

export interface FileSnapshot {
  path: string;
  mtimeMs: number;
  size: number;
}

export interface RunInput {
  task: string;
  projectDir: string;
  maxIterations?: number;
  onEvent?: (event: AgentEvent) => void;
}

export interface PlanResult {
  summary: string;
  steps: string[];
  risks: string[];
}

export interface PatchResult {
  summary: string;
  diff?: string;
}

export interface CheckResult {
  name: string;
  command: string;
  success: boolean;
  skipped: boolean;
  output: string;
  errors: string[];
  durationMs: number;
}

export interface ValidationResult {
  success: boolean;
  checks: CheckResult[];
}

export interface RunResult {
  success: boolean;
  task: string;
  projectDir: string;
  iterations: number;
  plan: PlanResult;
  validation: ValidationResult;
  review: string;
  events: AgentEvent[];
  skillsUsed: string[];
}

export interface RunRecord {
  id: string;
  timestamp: string;
  task: string;
  success: boolean;
  iterations: number;
  planSummary: string;
  validation: {
    success: boolean;
    commands: string[];
    errors: string[];
  };
  review: string;
  skillsUsed: string[];
}

export interface SkillStat {
  name: string;
  runs: number;
  successes: number;
  failures: number;
  score: number;
  disabled: boolean;
  disabledReason?: string;
  updatedAt: string;
}

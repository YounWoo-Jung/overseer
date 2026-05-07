export type RiskLevel = 'safe' | 'unknown' | 'danger';

export interface RiskAssessment {
  level: RiskLevel;
  flags: string[];
}

const SAFE_PATTERNS = [
  /^Please\s/i,
  /^Check\s/i,
  /^Review\s/i,
  /^Consider\s/i,
  /^Summarize\s/i,
  /^Validate\s/i,
];

const DANGEROUS_PATTERNS = [
  /rm\s+-[rR]f/,
  /\bsudo\b/,
  /\bsu\s/,
  /\bdoas\b/,
  /\bcurl\b.*\|\s*(sh|bash|zsh|fish)\b/,
  /\bwget\b.*\|\s*(sh|bash|zsh|fish)\b/,
  /\bgit\s+reset\s+.*--hard\b/,
  /\bgit\s+clean\s+.*-[fFdDxX]/,
  /\bgit\s+push\s+.*--force\b/,
  /\bdocker\s+system\s+prune\b.*-a/,
  /\bdocker\s+compose\s+down\b.*-v/,
  /\bkubectl\s+delete\b/,
  /\bmkfs\b/,
  /\bdd\s+.*of=\/dev\//,
  /\bshutdown\b|\breboot\b|\bpoweroff\b/,
  /\bchmod\s+777\b/,
  /\bDROP\s+(DATABASE|TABLE)\b/i,
  /;\s*\S+/,
  /&&|\|\||\$\(|`/,
];

export function scoreInjectionText(text: string): RiskAssessment {
  const trimmed = text.trim();
  const flags = DANGEROUS_PATTERNS
    .filter((pattern) => pattern.test(trimmed))
    .map((pattern) => pattern.source);
  if (flags.length > 0) return { level: 'danger', flags };
  if (SAFE_PATTERNS.some((pattern) => pattern.test(trimmed)) && trimmed.length <= 500) {
    return { level: 'safe', flags: [] };
  }
  return { level: 'unknown', flags: [] };
}

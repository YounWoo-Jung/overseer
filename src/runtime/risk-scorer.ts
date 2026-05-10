export type RiskLevel = 'safe' | 'unknown' | 'danger';

export interface RiskAssessment {
  level: RiskLevel;
  flags: string[];
  hardline?: boolean;
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

const HARDLINE_PATTERNS = [
  { pattern: /\brm\s+(-[^\s]*\s+)*(\/|\/\*|\/home|\/root|\/etc|~|\$HOME)(\s|$)/i, reason: 'hardline: destructive delete target' },
  { pattern: /\bmkfs(\.[a-z0-9]+)?\b/i, reason: 'hardline: filesystem format' },
  { pattern: /\bdd\b[^\n]*\bof=\/dev\/(sd|nvme|hd|mmcblk|vd|xvd)[a-z0-9]*/i, reason: 'hardline: raw block device write' },
  { pattern: />\s*\/dev\/(sd|nvme|hd|mmcblk|vd|xvd)[a-z0-9]*\b/i, reason: 'hardline: raw block device redirect' },
  { pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, reason: 'hardline: fork bomb' },
  { pattern: /\bkill\s+(-[^\s]+\s+)*-1\b/i, reason: 'hardline: kill all processes' },
  { pattern: /(?:^|[;&|\n`])\s*(?:sudo\s+)?(?:shutdown|reboot|halt|poweroff)\b/i, reason: 'hardline: system shutdown' },
  { pattern: /(?:^|[;&|\n`])\s*(?:sudo\s+)?systemctl\s+(poweroff|reboot|halt|kexec)\b/i, reason: 'hardline: system shutdown' },
];

export function scoreInjectionText(text: string): RiskAssessment {
  const trimmed = text.trim();
  const hardlineFlags = HARDLINE_PATTERNS
    .filter((item) => item.pattern.test(trimmed))
    .map((item) => item.reason);
  if (hardlineFlags.length > 0) return { level: 'danger', flags: hardlineFlags, hardline: true };

  const flags = DANGEROUS_PATTERNS
    .filter((pattern) => pattern.test(trimmed))
    .map((pattern) => pattern.source);
  if (flags.length > 0) return { level: 'danger', flags };
  if (SAFE_PATTERNS.some((pattern) => pattern.test(trimmed)) && trimmed.length <= 500) {
    return { level: 'safe', flags: [] };
  }
  return { level: 'unknown', flags: [] };
}

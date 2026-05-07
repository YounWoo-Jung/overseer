export interface TokenBudget {
  maxPromptTokens: number;
  maxContextTokens: number;
  maxSectionTokens: number;
  maxHistoryTokens: number;
  maxAssistLineTokens: number;
}

export const DEFAULT_TOKEN_BUDGET: TokenBudget = {
  maxPromptTokens: 12_000,
  maxContextTokens: 8_000,
  maxSectionTokens: 1_500,
  maxHistoryTokens: 900,
  maxAssistLineTokens: 120,
};

export function estimateTokens(text: string): number {
  return Math.ceil(stripAnsi(text).length / 4);
}

export function readTokenBudget(): TokenBudget {
  return {
    maxPromptTokens: readNumber('OVERSEER_MAX_PROMPT_TOKENS', DEFAULT_TOKEN_BUDGET.maxPromptTokens),
    maxContextTokens: readNumber('OVERSEER_MAX_CONTEXT_TOKENS', DEFAULT_TOKEN_BUDGET.maxContextTokens),
    maxSectionTokens: readNumber('OVERSEER_MAX_SECTION_TOKENS', DEFAULT_TOKEN_BUDGET.maxSectionTokens),
    maxHistoryTokens: readNumber('OVERSEER_MAX_HISTORY_TOKENS', DEFAULT_TOKEN_BUDGET.maxHistoryTokens),
    maxAssistLineTokens: readNumber('OVERSEER_MAX_ASSIST_LINE_TOKENS', DEFAULT_TOKEN_BUDGET.maxAssistLineTokens),
  };
}

export function filterNoisyText(text: string): string {
  const seen = new Map<string, number>();
  return stripAnsi(text)
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim())
    .filter((line) => !/^\s*(added|removed|changed)\s+\d+\s+packages?\b/i.test(line))
    .filter((line) => !/^\s*(npm notice|funding|found \d+ vulnerabilities)/i.test(line))
    .filter((line) => !line.includes('/node_modules/'))
    .filter((line) => {
      const key = line.trim();
      const count = seen.get(key) ?? 0;
      seen.set(key, count + 1);
      return count < 2;
    })
    .join('\n');
}

export function compactText(text: string, maxTokens: number, mode: 'tail' | 'middle' = 'tail'): string {
  const clean = filterNoisyText(text);
  if (estimateTokens(clean) <= maxTokens) return clean;
  const maxChars = Math.max(40, maxTokens * 4);
  const marker = '\n[...omitted...]\n';
  if (mode === 'middle') {
    const part = Math.floor((maxChars - marker.length) / 2);
    return `${clean.slice(0, part)}${marker}${clean.slice(-part)}`;
  }
  return `${marker}${clean.slice(-Math.max(0, maxChars - marker.length))}`;
}

export function compactLines(lines: string[], maxTokensPerLine: number): string[] {
  return lines
    .map((line) => compactText(line, maxTokensPerLine, 'middle'))
    .filter(Boolean);
}

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

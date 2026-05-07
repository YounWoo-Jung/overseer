export interface ClassifiedSignal {
  type: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  title: string;
  suggestion: string;
  evidence: string;
}

const RULES: {
  type: string;
  severity: ClassifiedSignal['severity'];
  title: string;
  pattern: RegExp;
  suggestion: string;
}[] = [
  {
    type: 'failure.detected',
    severity: 'error',
    title: 'Test or build failure detected',
    pattern: /\b(failed|failure|FAIL|error Command failed|npm ERR!|BUILD FAILED|Tests? failed)\b/i,
    suggestion: 'Compare the first root-cause failure line with recently changed files first.',
  },
  {
    type: 'type_error.detected',
    severity: 'error',
    title: 'Type error detected',
    pattern: /\b(TS\d{4}|TypeError|type error|Type mismatch|Unresolved reference)\b/i,
    suggestion: 'Check both the type definition and the call site together.',
  },
  {
    type: 'permission.required',
    severity: 'warning',
    title: 'Permission or approval prompt detected',
    pattern: /\b(permission denied|approve|approval|required permission|bypass permissions|confirm)\b/i,
    suggestion: 'Do not auto-inject into permission prompts; confirm the user intent first.',
  },
  {
    type: 'context.pressure',
    severity: 'warning',
    title: 'Context or token pressure detected',
    pattern: /\b(context too large|token limit|maximum context|too many tokens|compact|squash)\b/i,
    suggestion: 'Keep the recent output tail and root cause, then summarize middle logs.',
  },
  {
    type: 'patch.failure',
    severity: 'warning',
    title: 'Patch application failure detected',
    pattern: /\b(apply patch failed|patch failed|git apply.*failed|hunk FAILED|rejected)\b/i,
    suggestion: 'Re-read the current file state and retry with a smaller diff.',
  },
  {
    type: 'success.detected',
    severity: 'info',
    title: 'Successful validation detected',
    pattern: /\b(passed|success|build completed|BUILD SUCCESSFUL|compiled successfully|healthy)\b/i,
    suggestion: 'Record the success pattern and reuse the same validation command for the next task.',
  },
];

export function classifyPaneText(text: string): ClassifiedSignal[] {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const tail = lines.slice(-80);
  const haystack = tail.join('\n');
  const signals: ClassifiedSignal[] = [];
  for (const rule of RULES) {
    const match = haystack.match(rule.pattern);
    if (!match) continue;
    const evidence = tail.find((line) => rule.pattern.test(line)) ?? match[0];
    signals.push({
      type: rule.type,
      severity: rule.severity,
      title: rule.title,
      suggestion: rule.suggestion,
      evidence: evidence.slice(0, 300),
    });
  }
  return signals;
}

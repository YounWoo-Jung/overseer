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
    suggestion: '실패 로그의 첫 원인 라인과 최근 변경 파일을 먼저 대조하세요.',
  },
  {
    type: 'type_error.detected',
    severity: 'error',
    title: 'Type error detected',
    pattern: /\b(TS\d{4}|TypeError|type error|Type mismatch|Unresolved reference)\b/i,
    suggestion: '타입 정의와 호출부를 양쪽에서 같이 확인하세요.',
  },
  {
    type: 'permission.required',
    severity: 'warning',
    title: 'Permission or approval prompt detected',
    pattern: /\b(permission denied|approve|approval|required permission|bypass permissions|confirm)\b/i,
    suggestion: '권한 프롬프트는 자동 주입하지 말고 사용자의 의도 확인을 우선하세요.',
  },
  {
    type: 'context.pressure',
    severity: 'warning',
    title: 'Context or token pressure detected',
    pattern: /\b(context too large|token limit|maximum context|too many tokens|compact|squash)\b/i,
    suggestion: '최근 출력 tail과 실패 원인만 남기고 중간 로그는 요약하세요.',
  },
  {
    type: 'patch.failure',
    severity: 'warning',
    title: 'Patch application failure detected',
    pattern: /\b(apply patch failed|patch failed|git apply.*failed|hunk FAILED|rejected)\b/i,
    suggestion: '파일의 현재 상태를 다시 읽고 더 작은 diff로 재시도하세요.',
  },
  {
    type: 'success.detected',
    severity: 'info',
    title: 'Successful validation detected',
    pattern: /\b(passed|success|build completed|BUILD SUCCESSFUL|compiled successfully|healthy)\b/i,
    suggestion: '성공 패턴은 경험 DB에 누적하고 같은 검증 명령을 다음 작업에 재사용하세요.',
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

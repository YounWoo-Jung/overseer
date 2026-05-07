import type { ClassifiedSignal } from './classifier.js';
import { readEvents } from '../state/event-store.js';
import { appendHistory } from '../state/history-store.js';
import { findRelatedRuns } from '../state/learning-store.js';
import { autoMatchSkills } from '../state/skill-registry.js';
import { compactText } from './token-budget.js';

export interface TmuxAssistInsight {
  repeatCount: number;
  relatedRuns: string[];
  skills: string[];
  prompt: string;
  assistLines: string[];
}

export function buildTmuxAssistInsight(projectDir: string, signal: ClassifiedSignal): TmuxAssistInsight {
  const query = [signal.title, signal.evidence, signal.suggestion].join('\n');
  const repeatCount = readEvents(projectDir, 120).filter((event) => event.type === signal.type).length;
  const relatedRuns = findRelatedRuns(projectDir, query, 3).map((run) =>
    `${run.success ? 'success' : 'failed'}: ${run.task}`
  );
  const skills = autoMatchSkills(projectDir, query, 3).map((skill) => skill.name);
  const prefix = repeatCount >= 2 ? `Repeated signal (${repeatCount}x): ${signal.title}` : signal.title;
  const assistLines = [
    `Evidence: ${signal.evidence}`,
    relatedRuns.length ? `Related runs: ${relatedRuns.join(' / ')}` : '',
    skills.length ? `Recommended skills: ${skills.join(', ')}` : '',
    signal.suggestion,
  ].filter(Boolean);

  appendHistory(projectDir, {
    kind: signal.severity === 'info' ? 'note' : 'review',
    title: prefix,
    detail: assistLines.join('\n'),
  });

  return {
    repeatCount,
    relatedRuns,
    skills,
    prompt: compactText([
      `Attention: ${prefix}`,
      `Evidence: ${signal.evidence}`,
      relatedRuns.length ? `Related runs: ${relatedRuns.join(' / ')}` : '',
      skills.length ? `Recommended skills: ${skills.join(', ')}` : '',
      `Suggestion: ${signal.suggestion}`,
    ].filter(Boolean).join('\n'), 140, 'tail'),
    assistLines,
  };
}

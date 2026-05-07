import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { availableProvider } from '../llm/provider.js';
import { readRunRecords } from '../state/learning-store.js';
import { getRankedSkillStats } from '../state/skill-stats.js';
import { listAgentJobs, readAgentStatus, submitAgentJob } from '../runtime/agent-runtime.js';
import { readHistory, readProjectProfile } from '../state/history-store.js';
import { readTokenBudget } from '../runtime/token-budget.js';
import type { AgentEvent, AgentPhase, RunResult } from '../types.js';

type ViewMode = 'dashboard' | 'runs' | 'skills' | 'queue' | 'inbox' | 'plan' | 'help';

const PHASES: AgentPhase[] = ['context', 'plan', 'implement', 'validate', 'debug', 'review', 'learn', 'done'];

function phaseColor(phase: string): string {
  if (phase === 'done') return 'green';
  if (phase === 'debug') return 'yellow';
  if (phase === 'validate') return 'cyan';
  if (phase === 'review') return 'magenta';
  return 'white';
}

function phaseMark(event: AgentEvent): string {
  if (event.success === false) return 'x';
  if (event.success === true) return '+';
  if (event.phase === 'debug') return '!';
  return '-';
}

function progressBar(events: AgentEvent[]): string {
  const current = events.at(-1)?.phase;
  const currentIndex = current ? PHASES.indexOf(current) : -1;
  return PHASES.map((phase, index) => {
    if (index < currentIndex) return '#';
    if (index === currentIndex) return '>';
    return '-';
  }).join('');
}

function truncate(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, Math.max(0, length - 1))}.` : text;
}

export function App({ projectDir }: { projectDir: string }) {
  const { exit } = useApp();
  const [task, setTask] = useState('');
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [view, setView] = useState<ViewMode>('dashboard');
  const [notice, setNotice] = useState('type /help for commands');
  const [activeTask, setActiveTask] = useState('');
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const runs = readRunRecords(projectDir);
  const skillStats = getRankedSkillStats(projectDir);
  const jobs = listAgentJobs(projectDir);
  const status = readAgentStatus(projectDir);
  const history = readHistory(projectDir, 12);
  const profile = readProjectProfile(projectDir);
  const budget = readTokenBudget();
  const provider = availableProvider();
  const latestRun = runs.at(-1);
  const lastPlanEvent = useMemo(() => [...events].reverse().find((event) => event.phase === 'plan'), [events]);
  const currentPlan = result?.plan.steps.length
    ? result.plan.steps
    : lastPlanEvent
      ? [lastPlanEvent.message]
      : [];
  const successCount = runs.filter((run) => run.success).length;
  const failedCount = runs.length - successCount;

  useEffect(() => {
    if (!running || startedAt === null) return;
    const id = setInterval(() => setElapsedSec(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [running, startedAt]);

  const submit = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (trimmed === '/exit' || trimmed === '/quit') {
      exit();
      return;
    }
    if (trimmed === '/help') {
      setView('help');
      setNotice('showing command help');
      setTask('');
      return;
    }
    if (trimmed === '/status') {
      setView('dashboard');
      setNotice(`agent ${status?.state ?? 'not started'}, queue ${jobs.filter((item) => item.job.state === 'queued').length}`);
      setTask('');
      return;
    }
    if (trimmed === '/runs' || trimmed === '/skills' || trimmed === '/queue' || trimmed === '/inbox' || trimmed === '/plan') {
      setView(trimmed.slice(1) as ViewMode);
      setNotice(`view: ${trimmed.slice(1)}`);
      setTask('');
      return;
    }
    if (trimmed === '/clear') {
      setEvents([]);
      setResult(null);
      setNotice('transcript cleared');
      setTask('');
      return;
    }

    setTask('');
    setEvents([]);
    setResult(null);
    setActiveTask(trimmed);
    const job = submitAgentJob(projectDir, trimmed);
    setView('queue');
    setNotice(`queued ${job.id}`);
  };

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box borderStyle="single" paddingX={1} flexDirection="column">
        <Box justifyContent="space-between">
          <Text bold>overseer monitor</Text>
          <Text color={status?.state === 'running' ? 'yellow' : 'green'}>{status?.state ?? 'not started'}</Text>
        </Box>
        <Text color="gray">project: {projectDir}</Text>
        <Text color="gray">provider: {provider} | view: {view} | /help /queue /inbox /runs /skills /status /clear /exit</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Box gap={1}>
          <Box borderStyle="single" paddingX={1} flexDirection="column" width="33%">
            <Text bold>Agent</Text>
            <Text color="gray">state: {status?.state ?? 'not started'}</Text>
            <Text color="gray">queue: {jobs.filter((item) => item.job.state === 'queued').length}</Text>
            <Text color="gray">total: {runs.length}</Text>
            <Text color="green">success: {successCount}</Text>
            <Text color="red">failed: {failedCount}</Text>
            <Text color="gray">{profile ? `files: ${profile.fileCount}` : 'no profile yet'}</Text>
          </Box>
          <Box borderStyle="single" paddingX={1} flexDirection="column" width="34%">
            <Text bold>Skills</Text>
            {skillStats.slice(0, 4).map((skill) => (
              <Text key={skill.name} color={skill.disabled ? 'red' : 'gray'}>
                {truncate(skill.name, 22)}: {skill.score.toFixed(2)} ({skill.failures}f)
              </Text>
            ))}
            {skillStats.length === 0 && <Text color="gray">no skill stats</Text>}
          </Box>
          <Box borderStyle="single" paddingX={1} flexDirection="column" width="33%">
            <Text bold>Budget</Text>
            <Text color="gray">prompt: {budget.maxPromptTokens}</Text>
            <Text color="gray">context: {budget.maxContextTokens}</Text>
            <Text color={running ? 'yellow' : 'gray'}>{progressBar(events)}</Text>
            <Text color="gray">{activeTask ? truncate(activeTask, 36) : 'waiting'}</Text>
            {currentPlan.slice(0, 4).map((step, index) => (
              <Text key={`${step}-${index}`} color="gray">{index + 1}. {truncate(step, 38)}</Text>
            ))}
          </Box>
        </Box>

        <Box borderStyle="single" paddingX={1} flexDirection="column" marginTop={1}>
          <Text bold>{view === 'dashboard' ? 'Monitor' : view[0].toUpperCase() + view.slice(1)}</Text>
          {view === 'dashboard' && events.slice(-14).map((event, index) => (
            <Text key={`${event.timestamp}-${index}`} color={phaseColor(event.phase)}>
              {phaseMark(event)} [{event.phase}] {truncate(event.message, 100)}{event.success === false ? ' (failed)' : ''}
            </Text>
          ))}
          {view === 'runs' && runs.slice(-10).reverse().map((run) => (
            <Text key={run.id} color={run.success ? 'green' : 'red'}>
              {run.success ? '+' : 'x'} {run.timestamp.slice(0, 19)} {truncate(run.task, 86)}
            </Text>
          ))}
          {view === 'skills' && skillStats.slice(0, 12).map((skill) => (
            <Text key={skill.name} color={skill.disabled ? 'red' : skill.score >= 0.7 ? 'green' : 'yellow'}>
              {skill.disabled ? 'x' : '+'} {skill.name} score={skill.score.toFixed(2)} runs={skill.runs} failures={skill.failures}
            </Text>
          ))}
          {view === 'queue' && jobs.slice(-12).reverse().map((item) => (
            <Text key={item.job.id} color={item.job.state === 'failed' ? 'red' : item.job.state === 'done' ? 'green' : 'yellow'}>
              {item.job.state} {item.job.id} {truncate(item.job.task, 80)}
            </Text>
          ))}
          {view === 'inbox' && history.slice().reverse().map((item) => (
            <Text key={item.id} color="cyan">
              [{item.kind}] {truncate(item.title, 28)} - {truncate(item.detail, 80)}
            </Text>
          ))}
          {view === 'plan' && currentPlan.map((step, index) => (
            <Text key={`${step}-${index}`} color="cyan">{index + 1}. {step}</Text>
          ))}
          {view === 'help' && (
            <Box flexDirection="column">
              <Text color="cyan">자연어 입력은 백그라운드 어시스턴트 큐에 등록됩니다.</Text>
              <Text>/status  대시보드 보기</Text>
              <Text>/queue   어시스턴트 큐 보기</Text>
              <Text>/inbox   감시/학습 기록 보기</Text>
              <Text>/runs    최근 실행 보기</Text>
              <Text>/skills  스킬 점수/비활성 상태 보기</Text>
              <Text>/plan    현재/최근 계획 보기</Text>
              <Text>/clear   현재 화면 로그 지우기</Text>
              <Text>/exit    종료</Text>
            </Box>
          )}
          {view !== 'help' && events.length === 0 && runs.length === 0 && <Text color="gray">no activity yet</Text>}
        </Box>

        {result && (
          <Box borderStyle="single" paddingX={1} flexDirection="column" marginTop={1}>
            <Text color={result.success ? 'green' : 'red'}>
              result: {result.success ? 'success' : 'failed'} | iterations: {result.iterations} | skills: {result.skillsUsed.length}
            </Text>
            <Text color="gray">{truncate(result.review.replace(/\n+/g, ' '), 1000)}</Text>
          </Box>
        )}
      </Box>

      <Box marginTop={1} borderStyle="single" paddingX={1}>
        <Text color="green">manage &gt; </Text>
        <TextInput value={task} onChange={setTask} onSubmit={submit} />
      </Box>
      <Text color="gray">{notice}</Text>
    </Box>
  );
}

# Overseer Feature Wiring

## 실행 흐름

`overseer <tmux-session>`은 TUI를 열고 지정 tmux 세션만 감시한다. 비TTY에서는 같은 세션을 `runAutoAssistant`가 주기적으로 scan한다.

`/run <task>` 또는 `overseer run <task>`는 `runAutonomousTask`로 들어간다.

1. `loadProjectContext`
2. `planTask`
3. `implementTask`
4. patch guard
5. checkpoint
6. `git apply`
7. `validateProject`
8. 실패 시 `fixFailure` 반복
9. `reviewResult`
10. learning/completion 기록

## 이전에 추가된 기능

### Hardline Injection Gate

- 위치: `src/runtime/risk-scorer.ts`, `src/runtime/injector.ts`
- 동작: injection 제안의 prompt가 shutdown, raw disk write, root delete 같은 hardline 패턴이면 `approveInjection`에서 `--force`와 무관하게 차단한다.
- 연결: tmux signal 또는 idle scheduler가 `proposeInjection`을 만들고, 사용자가 `/approve` 또는 `overseer inject approve`를 실행할 때 최종 차단된다.

### Checkpoint

- 위치: `src/runtime/checkpoint.ts`
- 동작: autonomous patch 적용 전 `.overseer/checkpoints/shadow.git`에 shadow git commit을 만든다.
- 연결: `runAutonomousTask`의 implement/fix patch 직전에 `createCheckpoint`가 실행된다.
- CLI: `overseer checkpoint list`, `overseer checkpoint create`, `overseer checkpoint restore <id>`

### Completion / Acceptance Criteria

- 위치: `src/runtime/completion.ts`, `src/state/knowledge.ts`
- 동작: run 종료 후 완료 점수와 미충족 기준을 만든다.
- 출력: `.overseer/completion-report.md`, `.overseer/acceptance-criteria.json`
- 연결: `recordLearning`에서 `writeCompletionArtifacts`가 호출된다.
- CLI: `overseer done [dir]`

### Queue Crash Recovery

- 위치: `src/runtime/agent-runtime.ts`
- 동작: daemon 시작 시 `.overseer/running/*.json`에 남은 작업을 `.overseer/queue`로 되돌린다.
- 연결: `runAgentRuntime` 시작 직후 `recoverInterruptedJobs`가 실행된다.

## 이번에 추가된 기능

### Context References

- 위치: `src/runtime/context-references.ts`, `src/runtime/context.ts`
- 동작: task의 `@file:path`, `@path/to/file.ts`, `@file:path:10-30`를 읽어 context에 주입한다.
- 제한: project root 밖 경로, `..` traversal, context budget 초과는 제외한다.
- 연결: `loadProjectContext(projectDir, task)`가 task를 받을 때 자동 확장한다.

### File State / Stale Write Guard

- 위치: `src/runtime/file-state.ts`
- 동작: `@file`로 읽은 파일의 mtime/size snapshot을 저장하고, patch가 같은 파일을 수정하기 전에 mtime 변화를 확인한다.
- 연결: `runAutonomousTask`의 patch guard에서 `checkStaleWrites`가 실행된다.
- 결과: 읽은 뒤 외부에서 바뀐 파일이면 patch를 적용하지 않고 실패로 반환한다.

### Diff Verifier

- 위치: `src/runtime/diff-verifier.ts`
- 동작: patch diff의 touched files를 추출하고 민감 파일 수정, 큰 diff, `@file` 범위 밖 수정을 검사한다.
- 연결: `applyPatchWithGuards`가 `git apply` 전에 호출한다.
- 결과: 민감 파일은 차단, 큰 diff/범위 밖 수정은 warning으로 run output에 남긴다.

### Command Lanes

- 위치: `src/runtime/command-lane.ts`
- 동작: `scan`, `run`, `inject`, `background` lane별 queue를 제공한다.
- 연결: daemon의 observe scan과 job run, 비TTY auto assistant scan이 lane을 통해 직렬 실행된다.
- 노출: `overseer status`와 TUI monitor panel에 lane 상태를 표시한다.

### File Safety / Path Security

- 위치: `src/runtime/path-safety.ts`
- 동작: project root 밖 경로, traversal, `.env`, SSH key, home credential, system credential 경로를 감지한다.
- 연결: context reference 확장과 diff verifier에서 사용한다.

### Health Check

- 위치: `src/runtime/health.ts`
- 동작: Node, git, tmux, package.json, disk 사용량을 점검한다.
- CLI: `overseer doctor [dir]`

### Input Provenance

- 위치: `src/runtime/provenance.ts`
- 동작: CLI/TUI/tmux에서 들어온 요청 출처를 `.overseer/provenance.jsonl`에 기록한다.
- 연결: CLI `run/submit/goal`, TUI submit, tmux request pattern 관찰에 연결된다.
- CLI: `overseer provenance [dir]`

### Shell Hooks

- 위치: `src/runtime/shell-hooks.ts`
- 동작: `.overseer/hooks/<event>.sh`가 있으면 JSON payload를 stdin으로 넘겨 실행한다.
- 이벤트: `before-patch`, `after-patch`, `validation-failed`, `run-done`
- 연결: `runAutonomousTask` patch/validation/run 종료 지점에 연결된다.
- 규칙: hook 파일은 executable이어야 한다. `before-patch`가 실패하면 patch 적용을 중단한다.

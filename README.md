# Overseer

## English

Overseer is an AI CLI development assistant for tmux-based coding workflows.

Run `overseer <tmux-session>` to enter a single TUI for one tmux session with monitoring, analysis, command input, assistant logs, audit indexes, skill/plugin counts, call logs, and development knowledge state. Its development loop covers planning, implementation, validation, debugging, review, and learning.

### Features

- Auto-assists AI CLI panes in one specified tmux session
- Starts directly into a unified monitoring TUI
- Shows skill count, plugin count, call count, call logs, audit index, analysis index, and knowledge index
- Supports a development loop: plan, implement, validate, debug, review, learn
- Captures status, event logs, inbox notes, and run history
- Supports queued development tasks through a long-running agent mode
- Creates local checkpoints before autonomous patches and supports restore
- Scores completion and writes acceptance criteria after runs
- Supports `@file` context references, stale-write guards, diff scope checks, health checks, provenance logs, and shell hooks
- Tracks request patterns and runs prioritized idle product-completeness work after 10 minutes
- Sends an idle autopilot nudge into the monitored AI CLI pane after configured idleness without input or output
- Records prompt injections through the injection queue
- Reads Claude Code and Codex context conservatively
- Stores local runtime state in `.overseer/`

### Install

```bash
npm install
npm run build
```

### Usage

```bash
overseer <tmux-session>
overseer goal <task>
overseer checkpoint list
overseer checkpoint restore <id>
overseer done [dir]
overseer doctor [dir]
overseer provenance [dir]
overseer tmux panes <tmux-session>
overseer tmux watch <tmux-session> --once
```

Inside the TUI:

```bash
/calls
/audit
/knowledge
/logs
/run <task>
/goal <task>
/scan
/approve <id>
/deny <id>
```

### Configuration

Use `overseer.config.json` or `.overseer/config.json`.

Supported environment variables use the `OVERSEER_` prefix, including:

- `OVERSEER_MAX_CAPTURE_LINES`
- `OVERSEER_WATCH_INTERVAL_MS`
- `OVERSEER_INJECT_ENABLED`
- `OVERSEER_INJECT_COOLDOWN_MS`
- `OVERSEER_IDLE_SCHEDULER_ENABLED`
- `OVERSEER_IDLE_THRESHOLD_MS`
- `OVERSEER_IDLE_SCHEDULER_INTERVAL_MS`
- `OVERSEER_IDLE_AUTOPILOT_ENABLED`
- `OVERSEER_IDLE_AUTOPILOT_THRESHOLD_MS`
- `OVERSEER_IDLE_AUTOPILOT_COOLDOWN_MS`
- `OVERSEER_ALLOWED_SESSIONS`
- `OVERSEER_MAX_PROMPT_TOKENS`
- `OVERSEER_MAX_CONTEXT_TOKENS`

## 한국어

Overseer는 tmux 기반 코딩 워크플로우를 위한 AI CLI 개발 어시스턴트입니다.

`overseer <tmux-session>`를 실행하면 지정한 tmux 세션 1개를 대상으로 단일 TUI에 진입합니다. 이 화면에서 모니터링, 분석, 명령 입력, 어시스턴트 로그, 감사 지수, skill/plugin 수, 호출 로그, 개발 지식화 상태를 모두 확인합니다. 개발 루프는 계획, 구현, 검증, 디버깅, 리뷰, 학습 흐름을 기준으로 합니다.

### 주요 기능

- 지정한 tmux 세션 안의 AI CLI pane 감시
- 단일 실행으로 통합 모니터링 TUI 진입
- skill 수, plugin 수, 호출 수, 호출 로그, 감사/분석/지식 지수 표시
- 계획, 구현, 검증, 디버깅, 리뷰, 학습 개발 루프 지원
- 상태, 이벤트 로그, inbox 노트, 실행 기록 확인
- 큐 기반 개발 작업 및 장기 실행 에이전트 모드 지원
- 자동 패치 전 로컬 체크포인트 생성 및 복구 지원
- 실행 후 완료 점수와 acceptance criteria 기록
- `@file` 컨텍스트 참조, stale-write 방지, diff 범위 검사, health check, provenance 기록, shell hook 지원
- 요청 패턴과 backlog를 기준으로 10분 유휴 시 제품 완성도 작업 자동 실행
- 감시 중인 AI CLI pane이 설정된 시간 동안 입출력이 없으면 작업을 계속 진행하도록 자동 프롬프트 전송
- injection queue 기반 prompt injection 기록
- Claude Code와 Codex 컨텍스트를 읽기 전용으로 보수적으로 활용
- 로컬 런타임 상태를 `.overseer/`에 저장

### 설치

```bash
npm install
npm run build
```

### 사용법

```bash
overseer <tmux-session>
overseer goal <task>
overseer checkpoint list
overseer checkpoint restore <id>
overseer done [dir]
overseer doctor [dir]
overseer provenance [dir]
overseer tmux panes <tmux-session>
overseer tmux watch <tmux-session> --once
```

TUI 안에서 사용하는 명령:

```bash
/calls
/audit
/knowledge
/logs
/run <task>
/goal <task>
/scan
/approve <id>
/deny <id>
```

### 설정

`overseer.config.json` 또는 `.overseer/config.json`을 사용합니다.

환경변수는 `OVERSEER_` prefix를 사용합니다.

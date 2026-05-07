# Overseer

## English

Overseer is an AI CLI development assistant for tmux-based coding workflows.

It watches AI CLI sessions running inside tmux, keeps development context, records useful signals, and supports queued follow-up tasks. Its development loop covers planning, implementation, validation, debugging, review, and learning.

### Features

- Auto-assists AI CLI panes running inside tmux
- Supports a development loop: plan, implement, validate, debug, review, learn
- Captures status, event logs, inbox notes, and run history
- Supports queued development tasks through a long-running agent mode
- Proposes prompt injections through an approval queue
- Reads Claude Code and Codex context conservatively
- Stores local runtime state in `.overseer/`

### Install

```bash
npm install
npm run build
```

### Usage

```bash
overseer
overseer tui [dir]
overseer status [dir]
overseer inbox [dir]
overseer events [dir]
```

Advanced commands:

```bash
overseer daemon start [dir]
overseer daemon stop [dir]
overseer daemon status [dir]
overseer submit <task>
overseer inject list
overseer inject approve <id> [--force]
overseer inject deny <id>
```

### Configuration

Use `overseer.config.json` or `.overseer/config.json`.

Supported environment variables use the `OVERSEER_` prefix, including:

- `OVERSEER_MAX_CAPTURE_LINES`
- `OVERSEER_WATCH_INTERVAL_MS`
- `OVERSEER_INJECT_ENABLED`
- `OVERSEER_INJECT_COOLDOWN_MS`
- `OVERSEER_ALLOWED_SESSIONS`
- `OVERSEER_MAX_PROMPT_TOKENS`
- `OVERSEER_MAX_CONTEXT_TOKENS`

## 한국어

Overseer는 tmux 기반 코딩 워크플로우를 위한 AI CLI 개발 어시스턴트입니다.

tmux 안에서 실행 중인 AI CLI 세션을 감시하고, 개발 컨텍스트를 유지하며, 유용한 신호와 후속 작업 큐를 관리합니다. 개발 루프는 계획, 구현, 검증, 디버깅, 리뷰, 학습 흐름을 기준으로 합니다.

### 주요 기능

- tmux 안의 AI CLI pane 자동 감시
- 계획, 구현, 검증, 디버깅, 리뷰, 학습 개발 루프 지원
- 상태, 이벤트 로그, inbox 노트, 실행 기록 확인
- 큐 기반 개발 작업 및 장기 실행 에이전트 모드 지원
- 승인 큐 기반 prompt injection 제안
- Claude Code와 Codex 컨텍스트를 읽기 전용으로 보수적으로 활용
- 로컬 런타임 상태를 `.overseer/`에 저장

### 설치

```bash
npm install
npm run build
```

### 사용법

```bash
overseer
overseer tui [dir]
overseer status [dir]
overseer inbox [dir]
overseer events [dir]
```

고급 명령:

```bash
overseer daemon start [dir]
overseer daemon stop [dir]
overseer daemon status [dir]
overseer submit <task>
overseer inject list
overseer inject approve <id> [--force]
overseer inject deny <id>
```

### 설정

`overseer.config.json` 또는 `.overseer/config.json`을 사용합니다.

환경변수는 `OVERSEER_` prefix를 사용합니다.

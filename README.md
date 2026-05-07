# Overseer

## English

Overseer is an AI CLI development assistant for tmux-based coding workflows.

Run `overseer` to enter a single TUI for monitoring, analysis, command input, assistant logs, audit indexes, skill/plugin counts, call logs, and development knowledge state. Its development loop covers planning, implementation, validation, debugging, review, and learning.

### Features

- Auto-assists AI CLI panes running inside tmux
- Starts directly into a unified monitoring TUI
- Shows skill count, plugin count, call count, call logs, audit index, analysis index, and knowledge index
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
```

Inside the TUI:

```bash
/calls
/audit
/knowledge
/logs
/run <task>
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
- `OVERSEER_ALLOWED_SESSIONS`
- `OVERSEER_MAX_PROMPT_TOKENS`
- `OVERSEER_MAX_CONTEXT_TOKENS`

## 한국어

Overseer는 tmux 기반 코딩 워크플로우를 위한 AI CLI 개발 어시스턴트입니다.

`overseer`를 실행하면 단일 TUI로 바로 진입합니다. 이 화면에서 모니터링, 분석, 명령 입력, 어시스턴트 로그, 감사 지수, skill/plugin 수, 호출 로그, 개발 지식화 상태를 모두 확인합니다. 개발 루프는 계획, 구현, 검증, 디버깅, 리뷰, 학습 흐름을 기준으로 합니다.

### 주요 기능

- tmux 안의 AI CLI pane 자동 감시
- 단일 실행으로 통합 모니터링 TUI 진입
- skill 수, plugin 수, 호출 수, 호출 로그, 감사/분석/지식 지수 표시
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
```

TUI 안에서 사용하는 명령:

```bash
/calls
/audit
/knowledge
/logs
/run <task>
/scan
/approve <id>
/deny <id>
```

### 설정

`overseer.config.json` 또는 `.overseer/config.json`을 사용합니다.

환경변수는 `OVERSEER_` prefix를 사용합니다.

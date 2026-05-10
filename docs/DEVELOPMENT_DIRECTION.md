# Overseer 개발 방향성

## 제품 방향

- 핵심 UX: `overseer <tmux-session>` 단일 TUI.
- 대상: Claude Code와 Codex 중심의 tmux 개발 세션.
- 목표: 사용자 요청 패턴을 관찰하고, 10분 이상 유휴 상태면 제품 완성도를 높이는 작은 작업을 자동 실행한다.
- 안전 기준: 자동 실행은 기본 on이다. 승인 전용 모드가 필요하면 `OVERSEER_INJECT_ENABLED=false`로 끈다.

## 개발 원칙

- DDD: 도메인은 `session`, `request-pattern`, `idle-scheduler`, `injection`, `development-goal`로 나눈다.
- SDD: 기능 추가 전 입력/출력/완료 조건을 짧게 명세한다.
- TDD: 변경마다 `npm run typecheck`, 가능하면 `npm run build`를 통과시킨다.
- Agentic Development: 감시, 제안, 실행, 검증, 학습을 분리하고 실패 시 작은 수정으로 반복한다.
- Context Engineering: `MEMORY.md`, `SUMMARY.md`, `MISTAKE.md`, `.overseer/request-patterns.md`를 최신 컨텍스트로 유지한다.

## 유휴 스케줄러

- 사용자 요청은 TUI 입력과 tmux 세션에서 감지한 `/goal`, `/loop`, `/run` 계열 요청으로 기록한다.
- 패턴 파일: `.overseer/request-patterns.md`.
- 작업 후보 파일: `.overseer/backlog.json`.
- 우선순위: 실패 테스트/빌드 > 타입 오류 > 설정 위험 > 컨텍스트 불일치 > 검증 보강 > 문서/UX 완성도.
- 10분 이상 요청이 없으면 Claude Code pane에는 `/loop`, Codex pane에는 `/goal`을 전송한다.
- 작업 내용은 backlog 최상위 1개로 제한하고 Domain/Spec/Test 계약을 먼저 잡은 뒤 Implement-Test-Fix 후 결과만 짧게 남긴다.

## 추천 방향

- MVP를 유지하되 자동 실행 결과가 `.overseer` 로그에 남도록 관찰 가능성을 유지한다.
- 반복 요청이 쌓이면 `.overseer/request-patterns.md`를 기준으로 backlog 후보를 만들고, 작은 목표 단위로 `/goal`에 넣는다.
- 완성도 작업의 우선순위는 실패 테스트, 타입 오류, 설정 위험, 문서 불일치, UX 누락 순서로 둔다.

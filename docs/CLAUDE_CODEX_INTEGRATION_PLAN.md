# Claude/Codex Integration Plan

## Goal
- `overseer <tmux-session>` is the primary UX.
- It detects Claude Code/Codex panes inside one tmux session and performs audit, analysis, request-pattern tracking, and assistant note generation automatically.
- Keep tmux capture as fallback.
- Prefer product-native files and lifecycle hooks when Claude Code or Codex is available.
- Read generated state conservatively; never ingest credentials, full histories, paste caches, sqlite logs, or auth files.
- After 10 minutes without a user request, run product-completeness work by default: Claude Code receives `/loop`, Codex receives `/goal`.
- Select idle work from `.overseer/backlog.json` by priority, using request patterns and recent events.

## Claude Code
- Use hooks first: `PermissionRequest`, `PreToolUse`, `PostToolUseFailure`, `Stop`, `SessionEnd`, `FileChanged`.
- Store hook input through `overseer claude-hook [dir]`.
- Use current-project auto memory from `~/.claude/projects/<project>/memory/`.
- Index user components from `~/.claude/commands`, `~/.claude/skills`, `~/.claude/agents`, and `~/.claude/rules`.
- Surface risk from `~/.claude/settings.json`, especially dangerous permission prompt bypass.

## Codex
- Use Codex hooks when `[features].codex_hooks = true`.
- Store hook input through `overseer codex-hook [dir]`.
- Use `~/.codex/AGENTS.md`, `~/.codex/rules`, skills, and memory summaries as read-only context.
- Prefer user skills from `$HOME/.agents/skills`; treat `~/.codex/skills` as system/bundled skills.
- Track config risk from `~/.codex/config.toml`, especially `default_permissions`, hooks, and memories.

## MVP Order
1. Single-session TUI.
2. Detect only tmux panes that are running Claude Code or Codex.
3. Record audit events and assistant notes.
4. Use Claude/Codex local settings, memory, skills/rules/agents as read-only context.
5. Track request patterns in `.overseer/request-patterns.md`.
6. Maintain `.overseer/backlog.json` with failure/type/config/context/product-completeness priority.
7. Auto-send idle scheduler commands by default; disable with `OVERSEER_INJECT_ENABLED=false` when approval-only mode is needed.
8. Later: optional installer snippets for hooks/config after user approval.

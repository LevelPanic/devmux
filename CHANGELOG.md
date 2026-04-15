# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- `devmux down` now removes the git worktree after stopping the session, so the branch is freed for checkout elsewhere. Worktrees with uncommitted or untracked changes are preserved with a clear message — use `--force-worktree` to discard or `--keep-worktree` to skip removal entirely.
- `cleanup -w` now surfaces git errors instead of silently swallowing them.

## [0.2.0] - 2026-03-24

### Added

- `devmux show` — interactive split-pane TUI with session sidebar and live log viewer (alternate screen buffer, arrow key navigation, copy to clipboard)
- `devmux restart <session>` — stop and restart a session, preserving branch, directory, and env
- `devmux attach <session>` — attach to a running session's live output with real-time streaming and process health monitoring
- Env swapping on restart — `restart -e KEY=VAL` merges new env vars, `--clear-env` wipes and replaces. Shows a diff of changed values.
- Health check / readiness polling after `devmux up` and `devmux restart` — waits up to 30s for the server to accept connections
- `.gitignore` warning — `devmux init` and `devmux up` warn if `.devmux.json` is not in `.gitignore`
- Registry file locking — concurrent `devmux up` commands no longer clobber each other's registry entries
- Monorepo services — auto-detects apps in `apps/` and `packages/` with dev scripts, each runnable individually via `--service`
- Env file symlinking — auto-detects `.env` files and symlinks them from main repo into new worktrees via `envFiles` config

### Security

- `portKey` field on sessions prevents service port mappings from leaking across branches
- Dashboard stop button uses `JSON.stringify` for JS-context escaping
- Clipboard copy uses `execFileSync` with array args

## [0.1.0] - 2026-03-24

Initial release.

### Added

- `devmux up [branch]` — start a dev session with automatic worktree creation
- `devmux down [session]` — stop a session and release its port
- `devmux ls` — list active sessions with status, ports, and branches
- `devmux logs <session>` — tail session logs with follow mode
- `devmux dashboard` — web UI for viewing and managing sessions
- `devmux cleanup` — remove dead sessions, worktrees, and logs
- `devmux init` — generate a `.devmux.json` config file
- Auto-detection of package manager (pnpm, npm, yarn, bun)
- Auto-detection of dev command from `package.json` scripts
- Port memory — remembers which port was used for which branch
- Same-worktree mode (`-s`) with separate build directories
- `NO_COLOR` and TTY detection for accessible terminal output
- Cross-platform log tailing (no `tail` dependency)

### Security

- Shell injection prevention via `execFileSync` with array arguments
- Branch name validation against shell metacharacters
- XSS protection in dashboard via HTML escaping
- Dashboard bound to `127.0.0.1` (localhost only)
- Path traversal protection on logs API endpoint
- Atomic registry writes to prevent file corruption

[0.2.0]: https://github.com/LevelPanic/devmux/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/LevelPanic/devmux/releases/tag/v0.1.0

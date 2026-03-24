# devmux

Run multiple Next.js (or any) dev sessions across git worktrees from a single terminal.

## Install

```bash
npm install -g devmux
# or
npx devmux
```

## Quick Start

```bash
# Initialize config in your project
devmux init

# Start a session on a feature branch (creates a worktree automatically)
devmux up feature-login

# Start another session on a different branch
devmux up fix-header

# List all running sessions
devmux ls

# Open the web dashboard
devmux dashboard
```

## Commands

### `devmux up [branch]`

Start a dev session. Creates a git worktree for the branch if one doesn't exist.

```bash
devmux up feature-x              # New worktree + auto-assigned port
devmux up feature-x -p 3001      # Specific port
devmux up -s                      # Same worktree, separate .next dir
devmux up -n my-session           # Custom session name
devmux up -c "pnpm dev:web"      # Override the dev command
devmux up -e API_URL=http://...   # Extra env vars
```

**Options:**
| Flag | Description |
|------|-------------|
| `-p, --port <port>` | Use a specific port |
| `-c, --command <cmd>` | Override the dev command from config |
| `-s, --same-worktree` | Don't create a worktree; use current dir with a separate `.next` output dir |
| `-n, --name <name>` | Custom session name (default: branch name) |
| `-e, --env <K=V>` | Extra environment variables (repeatable) |

### `devmux down [session]`

Stop a session.

```bash
devmux down feature-x    # Stop one session
devmux down --all         # Stop all sessions
```

### `devmux ls`

List active sessions.

```bash
devmux ls          # Sessions for current project
devmux ls --all    # Sessions across all projects
devmux ls --json   # JSON output
```

### `devmux logs <session>`

Tail logs for a session.

```bash
devmux logs feature-x            # Follow logs (default)
devmux logs feature-x --no-follow  # Print and exit
devmux logs feature-x -n 100     # Last 100 lines
```

### `devmux dashboard`

Start a web dashboard showing all sessions with live status, links, and stop buttons.

```bash
devmux dashboard           # http://localhost:4000
devmux dashboard -p 4001   # Custom port
```

### `devmux cleanup`

Remove dead sessions from the registry.

```bash
devmux cleanup              # Just clean registry
devmux cleanup -w           # Also remove worktrees
devmux cleanup -l           # Also remove log files
devmux cleanup -f           # Force-stop all running sessions too
```

### `devmux init`

Create a `.devmux.json` config file in the project root.

## Configuration

Create `.devmux.json` in your project root (or run `devmux init`):

```json
{
  "command": "pnpm dev:web",
  "portRange": [3000, 3099],
  "worktreeDir": "../devmux-worktrees",
  "env": {},
  "postCreate": "pnpm install"
}
```

| Field | Description | Default |
|-------|-------------|---------|
| `command` | Dev server start command | `npm run dev` |
| `portRange` | `[min, max]` port range for auto-assignment | `[3000, 3099]` |
| `worktreeDir` | Where worktrees are created (relative to project root) | `../devmux-worktrees` |
| `env` | Extra env vars passed to all sessions | `{}` |
| `postCreate` | Command run in newly created worktrees | `npm install` |

## How It Works

**Worktree mode (default):** Each session gets its own git worktree — a fully isolated copy of the repo on a different branch. The worktree shares git history with the main repo but has its own working directory, `node_modules`, and `.next` cache.

**Same-worktree mode (`-s`):** Runs multiple dev servers from the same directory. Each session gets a unique `.next` output directory (via `NEXT_DIST_DIR` env var) to avoid build cache conflicts.

**Process management:** Sessions run as detached background processes. PIDs are tracked in `~/.devmux/registry.json`. Logs go to `~/.devmux/logs/<session>.log`.

**Port allocation:** Ports are auto-assigned from the configured range, skipping ports already in use (both by devmux sessions and by other processes).

## Environment Variables

These env vars are automatically set for every session:

| Variable | Value |
|----------|-------|
| `PORT` | The assigned port number |
| `DEVMUX_SESSION` | The session ID |
| `DEVMUX_PORT` | Same as PORT |
| `NEXT_DIST_DIR` | `.next-devmux-<id>` (same-worktree mode only) |

## License

MIT

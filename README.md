# devmux

Run multiple dev sessions across git worktrees from a single terminal. Zero config — auto-detects your repo, package manager, and dev command.

Built for Next.js but works with any dev server that accepts a `PORT` environment variable.

## Install

```bash
npm install -g devmux
```

Or run without installing:

```bash
npx devmux up feature-branch
```

## Quick Start

```bash
cd your-project

# Start a session — auto-detects everything, creates a worktree, picks a port
devmux up feature-auth

# Start another session on a different branch
devmux up fix-dashboard --port 3001

# See what's running
devmux ls

# Open the web dashboard
devmux dashboard

# Stop a session
devmux down feature-auth

# Stop everything
devmux down --all
```

No config file needed. On first run, devmux detects your package manager and dev command and creates `.devmux.json` automatically.

## How It Works

devmux has two modes:

**Worktree mode** (default) — each session gets its own [git worktree](https://git-scm.com/docs/git-worktree): a fully isolated copy of the repo on a different branch. Separate `node_modules`, separate `.next` cache, separate filesystem. Fully independent.

```
your-project/           ← main branch, port 3000
../devmux-worktrees/
  feature-auth/         ← feature-auth branch, port 3001
  fix-dashboard/        ← fix-dashboard branch, port 3002
```

**Same-worktree mode** (`--same-worktree`) — runs multiple servers from the same directory. Each gets a unique `.next` output directory to avoid build cache conflicts. Useful for testing two user sessions against the same code.

```bash
devmux up -s --name session-a    # port 3000, .next-devmux-session-a
devmux up -s --name session-b    # port 3001, .next-devmux-session-b
```

## Commands

### `devmux up [branch]`

Start a dev session.

```bash
devmux up feature-x              # New worktree, auto-assigned port
devmux up feature-x --port 3001  # Specific port (remembered for next time)
devmux up                         # Current branch
devmux up -s                      # Same worktree, separate .next dir
devmux up -n my-session           # Custom session name
devmux up -c "pnpm dev:api"      # Override the dev command
devmux up -e DEBUG=true           # Extra env vars
devmux up --service web           # Start a specific monorepo service
```

| Flag | Description |
|------|-------------|
| `-p, --port <port>` | Use a specific port (remembered for this branch) |
| `-c, --command <cmd>` | Override the dev command |
| `-s, --same-worktree` | Don't create a worktree; use current dir with a separate build cache |
| `-n, --name <name>` | Custom session name (default: branch name) |
| `--service <name>` | Run a specific service from the monorepo (see [Monorepo Services](#monorepo-services)) |
| `-e, --env <K=V>` | Extra environment variables (repeatable) |

After starting, devmux waits for the server to accept connections and shows a readiness indicator.

### `devmux restart <session>`

Stop and restart a session, preserving its branch, directory, and environment.

```bash
devmux restart feature-x             # Same port, same config
devmux restart feature-x --port 3005 # Change port on restart
devmux restart feature-x -c "new cmd" # Change command on restart
```

### `devmux attach <session>`

Attach to a running session's live output. Shows recent logs on connect, then streams new output in real time. The session keeps running when you detach (Ctrl+C).

```bash
devmux attach feature-x    # Ctrl+C to detach (session stays running)
```

### `devmux down [session]`

Stop a session and release its port.

```bash
devmux down feature-x    # Stop one session
devmux down --all         # Stop all sessions in this project
```

### `devmux ls`

List active sessions.

```bash
devmux ls          # Sessions for current project
devmux ls --all    # Sessions across all projects
devmux ls --json   # Machine-readable output
```

### `devmux logs <session>`

Tail session logs.

```bash
devmux logs feature-x              # Follow logs (default)
devmux logs feature-x --no-follow  # Print last 50 lines and exit
devmux logs feature-x -n 100       # Last 100 lines
```

### `devmux dashboard`

Web UI showing all sessions with live status, clickable port links, and stop buttons.

```bash
devmux dashboard           # http://localhost:4000
devmux dashboard -p 4001   # Custom port
```

### `devmux cleanup`

Remove dead sessions and optionally clean up worktrees and logs.

```bash
devmux cleanup              # Clean registry and release ports
devmux cleanup -w            # Also delete worktrees for dead sessions
devmux cleanup -l            # Also delete log files
devmux cleanup -f            # Force-stop all running sessions too
```

### `devmux init`

Explicitly generate a `.devmux.json` config file. Usually not needed — `devmux up` creates it automatically on first run.

## Configuration

devmux auto-generates `.devmux.json` in your project root by detecting your repo:

```json
{
  "name": "my-project",
  "command": "pnpm run dev",
  "packageManager": "pnpm",
  "portRange": [3000, 3099],
  "worktreeDir": "../devmux-worktrees",
  "env": {},
  "postCreate": "pnpm install",
  "ports": [],
  "services": {}
}
```

| Field | Description | Auto-detected from |
|-------|-------------|--------------------|
| `name` | Project name | `package.json` name field |
| `command` | Dev server command | `package.json` scripts (`dev:web` > `dev` > `start`) |
| `packageManager` | Package manager | Lockfile (`pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`, `bun.lock`) |
| `portRange` | Port range for auto-assignment | Default `[3000, 3099]` |
| `worktreeDir` | Where worktrees are created | Default `../devmux-worktrees` |
| `env` | Extra env vars for all sessions | Default `{}` |
| `postCreate` | Runs in new worktrees | Uses detected package manager (`pnpm install`, `npm install`, etc.) |
| `ports` | Remembered port-to-branch mappings | Managed automatically |
| `services` | Named services for monorepos | Auto-detected from `apps/` and `packages/` directories |

You can edit any field. The `ports` array is managed by devmux — when you assign a port to a branch, it's saved here so the next `devmux up` reuses it.

## Monorepo Services

In a monorepo, devmux auto-detects apps with dev scripts from `apps/` and `packages/` directories. Each becomes a named service you can start individually.

For a monorepo like:
```
apps/
  web/          ← has "dev" script
  api/          ← has "dev" script
  worker/       ← has "dev" script
```

devmux generates:
```json
{
  "services": {
    "web":    { "command": "pnpm run dev", "cwd": "apps/web" },
    "api":    { "command": "pnpm run dev", "cwd": "apps/api" },
    "worker": { "command": "pnpm run dev", "cwd": "apps/worker" }
  }
}
```

Then you can run them independently:

```bash
# Run the whole monorepo (default command)
devmux up feature-x

# Or run individual services on specific ports
devmux up feature-x --service web --port 3000
devmux up feature-x --service api --port 3001
devmux up feature-x --service worker --port 3002

# Each gets its own session (named branch:service)
devmux ls
# feature-x:web    ● running  :3000
# feature-x:api    ● running  :3001
# feature-x:worker ● running  :3002
```

You can customize services in `.devmux.json`:

```json
{
  "services": {
    "web": {
      "command": "pnpm run dev",
      "cwd": "apps/web",
      "port": 3000,
      "env": { "DEBUG": "true" }
    }
  }
}
```

| Service field | Description |
|---------------|-------------|
| `command` | The dev command for this service |
| `cwd` | Subdirectory relative to project root |
| `port` | Default port (used before auto-assignment) |
| `env` | Extra env vars for this service |

## Port Management

Ports are automatically managed:

1. **First run:** auto-assigned from `portRange`, or you specify with `--port`
2. **Remembered:** the port is saved in `.devmux.json` for that branch
3. **Next run:** the remembered port is reused automatically
4. **On stop:** the port mapping is cleared and the port is freed

```bash
devmux up feature-x --port 3001  # Assigns and remembers 3001
devmux down feature-x            # Releases 3001
devmux up feature-x              # Gets a new auto-assigned port
```

## Environment Variables

Set for every session automatically:

| Variable | Value |
|----------|-------|
| `PORT` | The assigned port number |
| `DEVMUX_SESSION` | The session ID |
| `DEVMUX_PORT` | Same as `PORT` |
| `NEXT_DIST_DIR` | `.next-devmux-<id>` (same-worktree mode only) |

Pass additional variables with `-e`:

```bash
devmux up feature-x -e API_URL=http://localhost:8080 -e DEBUG=true
```

## Where State Lives

| What | Location |
|------|----------|
| Project config + port memory | `.devmux.json` (project root) |
| Session registry | `~/.devmux/registry.json` |
| Session logs | `~/.devmux/logs/<session>.log` |
| Git worktrees | `../devmux-worktrees/<branch>/` |

Add `.devmux.json` to your `.gitignore` if port assignments are machine-specific. Or commit it if your team wants shared defaults.

## Requirements

- Node.js >= 18
- Git (for worktree operations)

## Compatibility

- **macOS, Linux, Windows** — cross-platform log tailing, no shell-specific commands
- **Any dev server** — anything that reads `PORT` from the environment works (Next.js, Vite, Remix, Express, etc.)
- **Any package manager** — auto-detects pnpm, npm, yarn, and bun
- **Monorepos** — detects workspace roots and uses the correct install/dev commands

## How devmux Compares

There are tools that manage worktrees and tools that run parallel scripts — but nothing combines both with dev server lifecycle management.

| Tool | Worktrees | Dev servers | Port management | Dashboard | Auto-detect |
|------|:---------:|:-----------:|:---------------:|:---------:|:-----------:|
| **devmux** | ✔ | ✔ | ✔ | ✔ | ✔ |
| [Worktrunk](https://github.com/max-sixty/worktrunk) | ✔ | — | — | — | — |
| [git-worktree-runner](https://github.com/coderabbitai/git-worktree-runner) | ✔ | — | — | — | Partial |
| [gwq](https://github.com/d-kuro/gwq) | ✔ | — | — | — | — |
| [concurrently](https://www.npmjs.com/package/concurrently) | — | ✔ | — | — | — |
| [npm-run-all](https://github.com/mysticatea/npm-run-all) | — | ✔ | — | — | — |

**Worktree managers** (Worktrunk, gwq, wtp, git-worktree-runner) handle creating and switching worktrees but don't manage running processes, assign ports, or track session state.

**Parallel runners** (concurrently, npm-run-all) run multiple scripts at once but have no worktree awareness, no port allocation, and no session persistence — if your terminal closes, everything dies.

devmux bridges the gap: worktree creation, dependency installation, background process management, port allocation, session registry, log tailing, and a web dashboard — all in one command.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

[MIT](LICENSE)

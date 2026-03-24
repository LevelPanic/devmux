# devmux

Run multiple dev sessions across git worktrees. Zero config — auto-detects your repo, package manager, dev command, services, and env files.

Works with any dev server that reads a `PORT` environment variable — Next.js, Vite, Remix, NestJS, Express, and more.

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

# Start a session on a feature branch
# (auto-detects everything, creates a worktree, picks a port)
devmux up feature-auth

# Start another session on a different branch
devmux up fix-dashboard --port 3001

# See what's running
devmux ls

# View all logs in a split-pane TUI (like pnpm/turbo)
devmux show

# Stop a session
devmux down feature-auth

# Stop everything
devmux down --all
```

No config file needed. On first run, devmux detects your project and creates `.devmux.json` automatically.

## What devmux Does

1. **Creates a git worktree** for the branch (isolated copy of your repo — separate `node_modules`, separate build cache)
2. **Symlinks your `.env` files** from the main repo so secrets carry over
3. **Runs your install command** (`npm install`, `pnpm install`, etc.)
4. **Starts the dev server** in the background with an assigned port
5. **Waits for the server** to accept connections and confirms it's ready
6. **Tracks everything** in a registry so you can list, restart, attach, and stop sessions

You can run multiple sessions simultaneously — each on a different branch, different port, fully isolated.

## How It Works

devmux has two modes:

### Worktree mode (default)

Each session gets its own [git worktree](https://git-scm.com/docs/git-worktree) — a fully isolated copy of the repo on a different branch.

```
your-project/                    ← main branch, port 3000
../devmux-worktrees/
  feature-auth/                  ← feature-auth branch, port 3001
  fix-dashboard/                 ← fix-dashboard branch, port 3002
```

### Same-worktree mode (`-s`)

Runs multiple servers from the same directory. Each gets a unique build output directory to avoid cache conflicts. Useful for testing two browser sessions against the same code.

```bash
devmux up -s --name session-a    # port 3000
devmux up -s --name session-b    # port 3001
```

## Commands

### `devmux up [branch]`

Start a dev session.

```bash
devmux up feature-x              # New worktree, auto-assigned port
devmux up feature-x --port 3001  # Specific port (remembered for next time)
devmux up                         # Current branch
devmux up -s                      # Same worktree mode
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

### `devmux show`

Interactive split-pane TUI for viewing logs — like pnpm's turbo mode. Opens in a fullscreen alternate screen buffer.

```bash
devmux show          # Sessions for current project
devmux show --all    # Sessions across all projects
```

```
 Tasks          │ web:3000
 ● » web        │ ▲ Next.js 14.2.0
 ● launcher     │ GET /api/dashboard 200 in 193ms
 ● thumbnail-api│ GET /api/launch 200 in 24ms
                │ POST /api/batch 201 in 64ms
────────────────────────────────────────────────
  ↑↓ Select   c Copy logs   Ctrl+C Exit
```

| Key | Action |
|-----|--------|
| `↑` `↓` | Switch between sessions |
| `c` | Copy visible logs to clipboard |
| `Ctrl+C` | Exit (sessions keep running) |

Auto-discovers new sessions as they start and marks dead ones. Use a separate terminal for `up`/`down`/`restart` while `show` is running.

### `devmux restart <session>`

Stop and restart a session. Preserves branch, directory, and environment. Supports swapping env vars on the fly.

```bash
devmux restart feature-x                                   # Same config
devmux restart feature-x --port 3005                        # Change port
devmux restart feature-x -e API_URL=http://localhost:4001   # Swap an env var
devmux restart feature-x --clear-env -e API_URL=...         # Wipe env, start fresh
```

| Flag | Description |
|------|-------------|
| `-p, --port <port>` | Change the port |
| `-c, --command <cmd>` | Change the command |
| `-e, --env <K=V>` | Override or add env vars (merges with existing, repeatable) |
| `--clear-env` | Clear all existing env vars before applying `--env` |

Shows a diff when env vars change:
```
→ API_URL: http://localhost:4000 → http://localhost:4001
```

### `devmux attach <session>`

Attach to a running session's live output. Shows recent logs, then streams in real time. Ctrl+C detaches — the session keeps running.

```bash
devmux attach feature-x
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
devmux logs feature-x --no-follow  # Print and exit
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
devmux cleanup -w            # Also delete orphaned worktrees
devmux cleanup -l            # Also delete log files
devmux cleanup -f            # Force-stop all running sessions too
```

### `devmux init`

Generate a `.devmux.json` config file. Usually not needed — `devmux up` creates it automatically.

## Configuration

devmux auto-generates `.devmux.json` by detecting your repo:

```json
{
  "name": "my-project",
  "command": "pnpm run dev",
  "packageManager": "pnpm",
  "portRange": [3000, 3099],
  "worktreeDir": "../devmux-worktrees",
  "env": {},
  "postCreate": "pnpm install",
  "envFiles": ["apps/web/.env", "apps/api/.env"],
  "ports": [],
  "services": {}
}
```

### What gets auto-detected

| Field | How it's detected |
|-------|-------------------|
| `name` | `package.json` name field |
| `command` | First match in `package.json` scripts: `dev:web` > `dev:app` > `dev:next` > `dev` > `start:dev` > `start` |
| `packageManager` | Lockfile: `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `bun.lock` → bun, else npm |
| `postCreate` | `{packageManager} install` |
| `envFiles` | Scans root, `apps/`, and `packages/` for `.env`, `.env.local`, `.env.development` |
| `services` | Scans `apps/` and `packages/` for subdirs with dev scripts |
| `ports` | Managed automatically as you assign ports |

### What you may need to customize

The auto-detection covers the basics. For projects with extra setup steps, you'll want to edit `postCreate`:

```json
{
  "postCreate": "pnpm install && cd apps/web && pnpm prisma generate"
}
```

Common things to add to `postCreate`:
- **Prisma**: `&& cd apps/your-app && pnpm prisma generate`
- **Codegen**: `&& pnpm graphql-codegen` or `&& pnpm generate`
- **Protobuf**: `&& pnpm proto:build`
- **Native deps**: `&& pnpm rebuild`

## Env Files and Worktrees

`.env` files are git-ignored, so they don't carry over when devmux creates a worktree. devmux solves this by **symlinking** `.env` files from your main repo into each new worktree.

### How it works

1. devmux scans your project for `.env` files and saves the paths in `envFiles`
2. When a new worktree is created, each file is symlinked back to the original
3. All worktrees share the same secrets — one source of truth, no drift

```
main-repo/apps/web/.env                 ← the real file
../devmux-worktrees/feature-x/apps/web/.env  → symlink to above
```

### Env layering

```
.env file (symlinked, shared)     ← base secrets (DB_URL, API keys)
  overridden by
devmux -e flags                   ← per-session overrides (API_URL, DEBUG)
```

The symlink handles secrets that are the same everywhere. The `-e` flags handle what differs per session.

### If env files aren't detected

devmux warns you:
```
⚠ No envFiles configured — worktree won't have .env files
```

Add them manually to `.devmux.json`:
```json
{
  "envFiles": [
    ".env",
    "apps/web/.env",
    "apps/api/.env.local"
  ]
}
```

### Per-worktree env overrides

If you need a worktree-specific value (e.g., a different database), delete the symlink and create a real file:

```bash
rm ../devmux-worktrees/feature-x/apps/web/.env
cp apps/web/.env ../devmux-worktrees/feature-x/apps/web/.env
# Edit the copy as needed
```

## Monorepo Services

In a monorepo, devmux auto-detects apps with dev scripts from `apps/` and `packages/`. Each becomes a named service you can start individually.

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

Run them independently:

```bash
devmux up feature-x --service web --port 3000
devmux up feature-x --service api --port 3001
devmux up feature-x --service worker --port 3002

devmux ls
# feature-x:web    ● running  :3000
# feature-x:api    ● running  :3001
# feature-x:worker ● running  :3002
```

Customize services in `.devmux.json`:

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
| `command` | Dev command for this service |
| `cwd` | Subdirectory relative to project root |
| `port` | Default port (used before auto-assignment) |
| `env` | Extra env vars for this service |

### Replacing your npm scripts

You can wire devmux into your `package.json` to replace turbo/concurrently:

```json
{
  "scripts": {
    "dev": "devmux up -s --service web --port 3000 && devmux up -s --service api --port 3001 && devmux show"
  }
}
```

Run `npm run dev` — starts both services, then opens the interactive TUI.

### Multi-service example

Run 3 frontends and 2 backends, then switch which backend a frontend talks to:

```bash
# Start backends
devmux up main --service api --port 4000
devmux up main --service api-v2 --port 4001

# Start frontends, all pointing at api
devmux up main --service dashboard --port 3000 -e API_URL=http://localhost:4000
devmux up main --service admin --port 3001 -e API_URL=http://localhost:4000
devmux up main --service mobile-web --port 3002 -e API_URL=http://localhost:4000

# Switch mobile-web to api-v2
devmux restart main:mobile-web -e API_URL=http://localhost:4001

# View all logs
devmux show
```

## Port Management

Ports are automatically managed:

1. **First run:** auto-assigned from `portRange`, or you specify with `--port`
2. **Remembered:** saved in `.devmux.json` for that branch/service
3. **Next run:** reused automatically
4. **On stop:** released

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

Swap env vars at runtime without stopping the session:

```bash
devmux restart main:frontend -e API_URL=http://localhost:4001
# Shows: API_URL: http://localhost:4000 → http://localhost:4001
```

## Where State Lives

| What | Location |
|------|----------|
| Project config + port memory | `.devmux.json` (project root) |
| Session registry | `~/.devmux/registry.json` |
| Session logs | `~/.devmux/logs/<session>.log` |
| Git worktrees | `../devmux-worktrees/<branch>/` |

Add `.devmux.json` to `.gitignore` if port assignments are machine-specific. Or commit it if your team wants shared defaults (services, postCreate, envFiles).

## Gotchas

### Worktrees don't have your `.env` files

Git-ignored files don't carry over to worktrees. devmux handles this automatically via the `envFiles` config — it symlinks them from your main repo. If you see missing env errors, check that your `.env` files are listed in `envFiles`.

### Code generation (Prisma, GraphQL, Protobuf)

`postCreate` only runs the install command by default. If your project needs code generation after install, add it:

```json
{
  "postCreate": "pnpm install && cd apps/web && pnpm prisma generate"
}
```

### pnpm build scripts blocked

pnpm v10+ blocks postinstall scripts by default. If you see warnings about "Ignored build scripts", either:
- Run `pnpm approve-builds` once in the worktree (interactive)
- Or add the specific generate commands to `postCreate` (recommended)

### Same port across worktrees

Each session needs its own port. If your app hardcodes a port instead of reading `PORT` from the environment, devmux can't manage it. Make sure your dev server reads `process.env.PORT`.

### Large monorepos and disk space

Each worktree gets its own `node_modules`. For large monorepos, this can add up. Use `devmux cleanup -w` to remove worktrees you're done with, or use `--same-worktree` mode when you don't need branch isolation.

## Requirements

- Node.js >= 18
- Git (for worktree operations)

## Compatibility

- **macOS, Linux, Windows** — cross-platform log tailing, no shell-specific commands
- **Any dev server** — anything that reads `PORT` from the environment
- **Any package manager** — auto-detects pnpm, npm, yarn, and bun
- **Monorepos** — auto-detects workspace apps and services

## How devmux Compares

| Tool | Worktrees | Dev servers | Port mgmt | Env files | TUI | Auto-detect |
|------|:---------:|:-----------:|:---------:|:---------:|:---:|:-----------:|
| **devmux** | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| [Worktrunk](https://github.com/max-sixty/worktrunk) | ✔ | — | — | — | — | — |
| [git-worktree-runner](https://github.com/coderabbitai/git-worktree-runner) | ✔ | — | — | Partial | — | Partial |
| [gwq](https://github.com/d-kuro/gwq) | ✔ | — | — | — | ✔ | — |
| [concurrently](https://www.npmjs.com/package/concurrently) | — | ✔ | — | — | — | — |
| [npm-run-all](https://github.com/mysticatea/npm-run-all) | — | ✔ | — | — | — | — |

**Worktree managers** handle creating and switching worktrees but don't manage running processes, assign ports, or track session state.

**Parallel runners** run multiple scripts at once but have no worktree awareness, no port allocation, and no session persistence — close your terminal, everything dies.

devmux bridges the gap: worktree creation, env file symlinking, dependency installation, background process management, port allocation, session registry, log tailing, interactive TUI, and a web dashboard.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

[MIT](LICENSE)

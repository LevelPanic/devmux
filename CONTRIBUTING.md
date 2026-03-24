# Contributing to devmux

Thanks for your interest in contributing. Here's how to get started.

## Development Setup

```bash
git clone https://github.com/LevelPanic/devmux.git
cd devmux
npm install
npm run dev    # watches and recompiles on change
```

The compiled output goes to `dist/`. The CLI entry point is `bin/devmux.js`, which imports `dist/cli.js`.

To test locally without installing globally:

```bash
node bin/devmux.js <command>
```

## Project Structure

```
src/
├── cli.ts                 # CLI entry point (commander setup)
├── commands/
│   ├── up.ts              # Start a session
│   ├── down.ts            # Stop a session
│   ├── restart.ts         # Restart a session (with env swapping)
│   ├── attach.ts          # Attach to live session output
│   ├── list.ts            # List sessions
│   ├── logs.ts            # Tail session logs
│   ├── dashboard.ts       # Web dashboard
│   ├── cleanup.ts         # Remove dead sessions
│   └── init.ts            # Generate config
└── lib/
    ├── colors.ts          # ANSI color helpers (NO_COLOR aware)
    ├── config.ts          # .devmux.json loading, auto-detection, services
    ├── health.ts          # Port readiness polling
    ├── lockfile.ts        # File-based locking for registry writes
    ├── paths.ts           # File path constants (~/.devmux/)
    ├── ports.ts           # Port availability checking
    ├── process-manager.ts # Spawn/kill background processes
    ├── registry.ts        # Session registry (~/.devmux/registry.json)
    └── worktree.ts        # Git worktree operations
```

## Guidelines

- **Zero unnecessary dependencies.** The package has 2 runtime deps (`commander`, `tree-kill`). Think hard before adding another. If Node has a built-in, use it.
- **Cross-platform.** Must work on macOS, Linux, and Windows. No shell-specific commands (`tail`, `grep`, etc.) — use Node APIs.
- **Security-conscious.** Never interpolate user input into shell commands. Use `execFileSync` with array args. Validate all inputs that touch the filesystem or git.
- **Accessible output.** Respect `NO_COLOR`, check `isTTY`, provide ASCII fallback symbols.

## Making Changes

1. Create a branch for your change
2. Make your edits in `src/`
3. Run `npm run build` to verify it compiles
4. Test manually with `node bin/devmux.js`
5. Open a PR with a clear description of what changed and why

## Reporting Issues

Open an issue at https://github.com/LevelPanic/devmux/issues with:

- What you ran
- What you expected
- What actually happened
- Your OS and Node version (`node -v`)

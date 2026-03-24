import { spawn, execSync } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import { logFilePath } from './paths.js';
import { addSession, removeSession, type Session } from './registry.js';
import treeKill from 'tree-kill';

export interface SpawnOptions {
  id: string;
  branch: string;
  worktreeDir: string;
  port: number;
  projectRoot: string;
  command: string;
  sameWorktree: boolean;
  env?: Record<string, string>;
}

/** Spawn a detached dev server process */
export function spawnSession(opts: SpawnOptions): Session {
  const logFile = logFilePath(opts.id);
  const fd = openSync(logFile, 'a');

  const childEnv: Record<string, string> = {
    ...process.env as Record<string, string>,
    PORT: String(opts.port),
    DEVMUX_SESSION: opts.id,
    DEVMUX_PORT: String(opts.port),
    ...opts.env,
  };

  // If same worktree, set a unique distDir to avoid .next conflicts
  if (opts.sameWorktree) {
    childEnv.NEXT_DIST_DIR = `.next-devmux-${opts.id}`;
  }

  const child = spawn(opts.command, {
    cwd: opts.worktreeDir,
    env: childEnv,
    detached: true,
    stdio: ['ignore', fd, fd],
    shell: true,
  });

  child.unref();

  // Close the fd in the parent — child has its own copy
  closeSync(fd);

  const pid = child.pid;
  if (!pid) {
    throw new Error(`Failed to spawn process for session "${opts.id}" — command: ${opts.command}`);
  }

  const session: Session = {
    id: opts.id,
    branch: opts.branch,
    worktreeDir: opts.worktreeDir,
    port: opts.port,
    pid,
    projectRoot: opts.projectRoot,
    command: opts.command,
    sameWorktree: opts.sameWorktree,
    startedAt: new Date().toISOString(),
    env: opts.env || {},
  };

  addSession(session);
  return session;
}

/** Kill a session's process tree with graceful shutdown */
export function killSession(id: string): Promise<Session | undefined> {
  return new Promise((resolve) => {
    const session = removeSession(id);
    if (!session) {
      resolve(undefined);
      return;
    }

    // Send SIGTERM first
    treeKill(session.pid, 'SIGTERM', (err) => {
      if (err) {
        // Process might already be dead — that's fine
        resolve(session);
        return;
      }

      // Give 3 seconds for graceful shutdown, then SIGKILL
      const timeout = setTimeout(() => {
        treeKill(session.pid, 'SIGKILL', () => resolve(session));
      }, 3000);

      // Poll to see if process died
      const poll = setInterval(() => {
        try {
          process.kill(session.pid, 0);
          // Still alive, keep waiting
        } catch {
          // Dead — clean up and resolve
          clearInterval(poll);
          clearTimeout(timeout);
          resolve(session);
        }
      }, 200);
    });
  });
}

/** Run a one-off command in a directory (e.g., postCreate) */
export function runCommand(command: string, cwd: string): void {
  execSync(command, { cwd, stdio: 'inherit' });
}

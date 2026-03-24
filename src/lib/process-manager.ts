import { spawn, execSync } from 'node:child_process';
import { openSync } from 'node:fs';
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

  // Pass the full command string to shell — avoids escaping issues
  const child = spawn(opts.command, {
    cwd: opts.worktreeDir,
    env: childEnv,
    detached: true,
    stdio: ['ignore', fd, fd],
    shell: true,
  });

  child.unref();

  const session: Session = {
    id: opts.id,
    branch: opts.branch,
    worktreeDir: opts.worktreeDir,
    port: opts.port,
    pid: child.pid!,
    projectRoot: opts.projectRoot,
    command: opts.command,
    sameWorktree: opts.sameWorktree,
    startedAt: new Date().toISOString(),
    env: opts.env || {},
  };

  addSession(session);
  return session;
}

/** Kill a session's process tree */
export function killSession(id: string): Promise<Session | undefined> {
  return new Promise((resolve) => {
    const session = removeSession(id);
    if (!session) {
      resolve(undefined);
      return;
    }

    treeKill(session.pid, 'SIGTERM', (err) => {
      if (err) {
        // Process might already be dead
        try {
          treeKill(session.pid, 'SIGKILL', () => resolve(session));
        } catch {
          resolve(session);
        }
      } else {
        resolve(session);
      }
    });
  });
}

/** Run a one-off command in a directory (e.g., postCreate) */
export function runCommand(command: string, cwd: string): void {
  execSync(command, { cwd, stdio: 'inherit' });
}

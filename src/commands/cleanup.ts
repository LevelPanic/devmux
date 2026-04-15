import { getSessions, pruneDeadSessions } from '../lib/registry.js';
import { removeWorktree } from '../lib/worktree.js';
import { killSession } from '../lib/process-manager.js';
import { findProjectRoot, loadConfig, forgetPort } from '../lib/config.js';
import { bold, green, yellow, dim, symbols } from '../lib/colors.js';
import { existsSync, rmSync } from 'node:fs';
import { logFilePath } from '../lib/paths.js';

interface CleanupOptions {
  worktrees?: boolean;
  logs?: boolean;
  force?: boolean;
}

function clearPorts(sessions: Array<{ branch: string; portKey?: string }>): void {
  try {
    const projectRoot = findProjectRoot();
    const config = loadConfig(projectRoot);
    for (const s of sessions) {
      forgetPort(config, s.portKey || s.branch, projectRoot);
    }
  } catch {
    // Not critical
  }
}

export async function cleanup(opts: CleanupOptions): Promise<void> {
  // 1. Prune dead sessions
  const dead = pruneDeadSessions();
  if (dead.length > 0) {
    console.log(`${green(symbols.tick)} Removed ${bold(String(dead.length))} dead session(s) from registry`);
    for (const s of dead) {
      console.log(`  ${dim(s.id)} (port ${s.port})`);
    }
    clearPorts(dead);
  } else {
    console.log(`${dim('No dead sessions in registry')}`);
  }

  // 2. Optionally remove worktrees for dead sessions
  if (opts.worktrees) {
    console.log('');
    for (const session of dead) {
      if (!session.sameWorktree && existsSync(session.worktreeDir)) {
        console.log(`${dim(symbols.arrow)} Removing worktree: ${session.worktreeDir}`);
        try {
          removeWorktree(session.worktreeDir, session.projectRoot, { force: true });
          console.log(`  ${green(symbols.tick)} Done`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(`  ${yellow(symbols.warning)} Failed: ${msg.trim()}`);
        }
      }
    }
  }

  // 3. Optionally clean up log files for dead sessions
  if (opts.logs) {
    console.log('');
    for (const session of dead) {
      const logFile = logFilePath(session.id);
      if (existsSync(logFile)) {
        rmSync(logFile);
        console.log(`${dim(symbols.arrow)} Removed log: ${logFile}`);
      }
    }
  }

  // 4. If force, stop all sessions
  if (opts.force) {
    const alive = getSessions();
    if (alive.length > 0) {
      console.log(`\n${yellow(symbols.warning)} Force-stopping ${alive.length} running session(s)...`);
      for (const session of alive) {
        await killSession(session.id);
        console.log(`  ${green(symbols.tick)} ${session.id}`);
      }
      clearPorts(alive);
    }
  }

  console.log(`\n${green(symbols.tick)} Cleanup complete`);
}

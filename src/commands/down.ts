import { existsSync } from 'node:fs';
import { getSession, getSessionsByProject, isProcessAlive, type Session } from '../lib/registry.js';
import { killSession } from '../lib/process-manager.js';
import { findProjectRoot, loadConfig, forgetPort } from '../lib/config.js';
import { removeWorktree } from '../lib/worktree.js';
import { bold, green, yellow, red, dim, symbols } from '../lib/colors.js';

interface DownOptions {
  all?: boolean;
  keepWorktree?: boolean;
  forceWorktree?: boolean;
}

/**
 * Remove git worktrees for killed sessions. Skips main-repo (sameWorktree) sessions.
 * Without `force`, git refuses if the worktree is dirty — we surface that so the user
 * can commit or explicitly opt in to destroy with `--force-worktree`.
 */
function removeWorktrees(sessions: Session[], force: boolean): void {
  for (const s of sessions) {
    if (s.sameWorktree) continue;
    if (!existsSync(s.worktreeDir)) continue;
    try {
      removeWorktree(s.worktreeDir, s.projectRoot, { force });
      console.log(`  ${green(symbols.tick)} Removed worktree ${dim(s.worktreeDir)}`);
    } catch (err) {
      const msg = (err instanceof Error ? err.message : String(err)).trim();
      console.log(`  ${yellow(symbols.warning)} Kept worktree ${s.worktreeDir}`);
      console.log(`    ${dim(msg)}`);
      console.log(`    ${dim('Commit/stash changes, or re-run with --force-worktree to discard')}`);
    }
  }
}

/** Clear ports for a batch of sessions — loads config once */
function clearPorts(sessions: Session[]): void {
  if (sessions.length === 0) return;
  try {
    const projectRoot = findProjectRoot();
    const config = loadConfig(projectRoot);
    for (const s of sessions) {
      forgetPort(config, s.portKey || s.branch, projectRoot);
    }
  } catch {
    // Config might not exist — not critical
  }
}

export async function down(sessionId: string | undefined, opts: DownOptions): Promise<void> {
  if (opts.all) {
    const projectRoot = findProjectRoot();
    const sessions = getSessionsByProject(projectRoot);
    if (sessions.length === 0) {
      console.log(`${dim('No active sessions for this project')}`);
      return;
    }

    console.log(`Stopping ${bold(String(sessions.length))} session(s)...`);
    const killed: Session[] = [];
    for (const session of sessions) {
      const k = await killSession(session.id);
      if (k) {
        killed.push(k);
        console.log(`  ${green(symbols.tick)} ${session.id} (port ${session.port})`);
      }
    }
    clearPorts(killed);
    if (!opts.keepWorktree) removeWorktrees(killed, !!opts.forceWorktree);
    console.log(`\n${green(symbols.tick)} All sessions stopped, ports released`);
    return;
  }

  if (!sessionId) {
    console.error(`${red(symbols.cross)} Specify a session ID or use ${bold('--all')}`);
    process.exit(1);
  }

  const session = getSession(sessionId);
  if (!session) {
    console.error(`${red(symbols.cross)} Session ${bold(sessionId)} not found`);
    console.log(`${dim('Run')} devmux ls ${dim('to see active sessions')}`);
    process.exit(1);
  }

  if (!isProcessAlive(session.pid)) {
    console.log(`${yellow(symbols.warning)} Session ${bold(sessionId)} is already dead, cleaning up`);
  } else {
    console.log(`Stopping ${bold(sessionId)}...`);
  }

  await killSession(sessionId);
  clearPorts([session]);
  if (!opts.keepWorktree) removeWorktrees([session], !!opts.forceWorktree);
  console.log(`${green(symbols.tick)} Session ${bold(sessionId)} stopped, port ${session.port} released`);
}

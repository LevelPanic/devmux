import { getSessions, getSessionsByProject, isProcessAlive, pruneDeadSessions } from '../lib/registry.js';
import { findProjectRoot } from '../lib/config.js';
import { bold, green, red, cyan, dim, gray, symbols } from '../lib/colors.js';

interface ListOptions {
  all?: boolean;
  json?: boolean;
}

export function list(opts: ListOptions): void {
  // Prune dead sessions first
  const dead = pruneDeadSessions();
  if (dead.length > 0 && !opts.json) {
    console.log(`${dim(`Cleaned up ${dead.length} dead session(s)`)}\n`);
  }

  const sessions = opts.all ? getSessions() : getSessionsByProject(findProjectRoot());

  if (opts.json) {
    console.log(JSON.stringify(sessions, null, 2));
    return;
  }

  if (sessions.length === 0) {
    console.log(`${dim('No active sessions')}`);
    if (!opts.all) {
      console.log(`${dim('Use')} --all ${dim('to show sessions from all projects')}`);
    }
    return;
  }

  const scope = opts.all ? 'all projects' : 'this project';
  console.log(`${bold('Active sessions')} ${dim(`(${scope})`)}:\n`);

  for (const session of sessions) {
    const alive = isProcessAlive(session.pid);
    const status = alive
      ? `${green(symbols.bullet)} running`
      : `${red(symbols.bullet)} dead`;

    const mode = session.sameWorktree ? dim('[same-worktree]') : '';

    console.log(`  ${bold(session.id)} ${status} ${mode}`);
    console.log(`    ${dim('Port')}:   ${cyan(String(session.port))} → ${cyan(`http://localhost:${session.port}`)}`);
    console.log(`    ${dim('Branch')}: ${session.branch}`);
    console.log(`    ${dim('PID')}:    ${gray(String(session.pid))}`);
    console.log(`    ${dim('Dir')}:    ${gray(session.worktreeDir)}`);
    console.log(`    ${dim('Since')}:  ${gray(new Date(session.startedAt).toLocaleString())}`);
    console.log('');
  }
}

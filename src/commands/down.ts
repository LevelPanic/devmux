import { getSession, getSessionsByProject, isProcessAlive, type Session } from '../lib/registry.js';
import { killSession } from '../lib/process-manager.js';
import { findProjectRoot, loadConfig, forgetPort } from '../lib/config.js';
import { bold, green, yellow, red, dim, symbols } from '../lib/colors.js';

interface DownOptions {
  all?: boolean;
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
  console.log(`${green(symbols.tick)} Session ${bold(sessionId)} stopped, port ${session.port} released`);
}

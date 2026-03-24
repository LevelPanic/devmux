import { getSession, getSessions, isProcessAlive } from '../lib/registry.js';
import { killSession } from '../lib/process-manager.js';
import { findProjectRoot, loadConfig, forgetPort } from '../lib/config.js';
import { bold, green, yellow, red, dim, symbols } from '../lib/colors.js';

interface DownOptions {
  all?: boolean;
}

function clearPort(branch: string): void {
  try {
    const projectRoot = findProjectRoot();
    const config = loadConfig(projectRoot);
    forgetPort(config, branch, projectRoot);
  } catch {
    // Config might not exist — not critical
  }
}

export async function down(sessionId: string | undefined, opts: DownOptions): Promise<void> {
  if (opts.all) {
    const sessions = getSessions();
    if (sessions.length === 0) {
      console.log(`${dim('No active sessions')}`);
      return;
    }

    console.log(`Stopping ${bold(String(sessions.length))} session(s)...`);
    for (const session of sessions) {
      const killed = await killSession(session.id);
      if (killed) {
        clearPort(killed.branch);
        console.log(`  ${green(symbols.tick)} ${session.id} (port ${session.port})`);
      }
    }
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
  clearPort(session.branch);
  console.log(`${green(symbols.tick)} Session ${bold(sessionId)} stopped, port ${session.port} released`);
}

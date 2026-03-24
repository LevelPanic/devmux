import { getSession, isProcessAlive } from '../lib/registry.js';
import { killSession, spawnSession } from '../lib/process-manager.js';
import { findProjectRoot, loadConfig, rememberPort } from '../lib/config.js';
import { findAvailablePort, isPortAvailable } from '../lib/ports.js';
import { logFilePath } from '../lib/paths.js';
import { bold, green, yellow, red, cyan, dim, symbols } from '../lib/colors.js';

interface RestartOptions {
  port?: string;
  command?: string;
}

export async function restart(sessionId: string, opts: RestartOptions): Promise<void> {
  const session = getSession(sessionId);
  if (!session) {
    console.error(`${red(symbols.cross)} Session ${bold(sessionId)} not found`);
    console.log(`${dim('Run')} devmux ls ${dim('to see active sessions')}`);
    process.exit(1);
  }

  // Kill existing
  if (isProcessAlive(session.pid)) {
    console.log(`${dim(symbols.arrow)} Stopping ${bold(sessionId)}...`);
    await killSession(sessionId);
  } else {
    // Clean up the dead registry entry
    await killSession(sessionId);
    console.log(`${dim(symbols.arrow)} Session was dead, restarting...`);
  }

  // Resolve port — use explicit, or reuse same port, or find new one
  let port: number;
  if (opts.port) {
    port = parseInt(opts.port, 10);
    if (!(await isPortAvailable(port))) {
      console.error(`${red(symbols.cross)} Port ${port} is not available`);
      process.exit(1);
    }
  } else if (await isPortAvailable(session.port)) {
    port = session.port;
  } else {
    const projectRoot = findProjectRoot();
    const config = loadConfig(projectRoot);
    port = await findAvailablePort(config.portRange);
    console.log(`${yellow(symbols.warning)} Port ${session.port} is busy, using ${cyan(String(port))}`);
  }

  // Remember port
  try {
    const projectRoot = findProjectRoot();
    const config = loadConfig(projectRoot);
    rememberPort(config, session.branch, port, projectRoot);
  } catch {
    // Non-critical
  }

  // Respawn with same settings
  const command = opts.command || session.command;

  const newSession = spawnSession({
    id: sessionId,
    branch: session.branch,
    worktreeDir: session.worktreeDir,
    port,
    projectRoot: session.projectRoot,
    command,
    sameWorktree: session.sameWorktree,
    env: session.env,
  });

  console.log('');
  console.log(`${green(symbols.tick)} Session ${bold(sessionId)} restarted`);
  console.log('');
  console.log(`  ${bold('URL')}:    ${cyan(`http://localhost:${port}`)}`);
  console.log(`  ${bold('PID')}:    ${dim(String(newSession.pid))}`);
  console.log(`  ${bold('Branch')}: ${session.branch}`);
  console.log(`  ${bold('Logs')}:   ${dim(logFilePath(sessionId))}`);
}

import { getSession, isProcessAlive } from '../lib/registry.js';
import { killSession, spawnSession } from '../lib/process-manager.js';
import { findProjectRoot, loadConfig, rememberPort } from '../lib/config.js';
import { findAvailablePort, isPortAvailable } from '../lib/ports.js';
import { waitForReady } from '../lib/health.js';
import { logFilePath } from '../lib/paths.js';
import { bold, green, yellow, red, cyan, dim, symbols } from '../lib/colors.js';

interface RestartOptions {
  port?: string;
  command?: string;
  env?: string[];
  clearEnv?: boolean;
}

function parseEnvFlags(flags: string[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const e of flags) {
    const [key, ...rest] = e.split('=');
    if (key && rest.length > 0) {
      env[key] = rest.join('=');
    }
  }
  return env;
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
    await killSession(sessionId);
    console.log(`${dim(symbols.arrow)} Session was dead, restarting...`);
  }

  // Resolve port
  const projectRoot = findProjectRoot();
  const config = loadConfig(projectRoot);
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
    port = await findAvailablePort(config.portRange);
    console.log(`${yellow(symbols.warning)} Port ${session.port} is busy, using ${cyan(String(port))}`);
  }

  // Remember port using the correct key (branch or branch:service)
  const portKey = session.portKey || session.branch;
  try {
    rememberPort(config, portKey, port, projectRoot);
  } catch {
    // Non-critical
  }

  // Build env: start from session's existing env, then apply overrides
  let env: Record<string, string>;
  if (opts.clearEnv) {
    // --clear-env: start fresh, only use --env flags
    env = opts.env ? parseEnvFlags(opts.env) : {};
  } else {
    // Default: merge new env on top of existing
    env = { ...session.env };
    if (opts.env) {
      const overrides = parseEnvFlags(opts.env);
      Object.assign(env, overrides);
    }
  }

  // Show env changes
  if (opts.env && opts.env.length > 0) {
    const changes = parseEnvFlags(opts.env);
    for (const [key, val] of Object.entries(changes)) {
      const old = session.env[key];
      if (old && old !== val) {
        console.log(`${dim(symbols.arrow)} ${bold(key)}: ${red(old)} ${dim(symbols.arrow)} ${green(val)}`);
      } else if (!old) {
        console.log(`${dim(symbols.arrow)} ${bold(key)}: ${green(val)} ${dim('(new)')}`);
      }
    }
  }

  // Respawn
  const command = opts.command || session.command;

  const newSession = spawnSession({
    id: sessionId,
    branch: session.branch,
    worktreeDir: session.worktreeDir,
    port,
    portKey,
    projectRoot: session.projectRoot,
    command,
    sameWorktree: session.sameWorktree,
    env,
  });

  console.log('');
  console.log(`${green(symbols.tick)} Session ${bold(sessionId)} restarted`);
  console.log('');
  console.log(`  ${bold('URL')}:    ${cyan(`http://localhost:${port}`)}`);
  console.log(`  ${bold('PID')}:    ${dim(String(newSession.pid))}`);
  console.log(`  ${bold('Branch')}: ${session.branch}`);
  console.log(`  ${bold('Logs')}:   ${dim(logFilePath(sessionId))}`);

  // Health check
  process.stdout.write(`\n  ${dim('Waiting for server...')} `);
  const health = await waitForReady(port, newSession.pid, 30000, (elapsed) => {
    const secs = Math.floor(elapsed / 1000);
    process.stdout.write(`\r  ${dim('Waiting for server...')} ${dim(`${secs}s`)} `);
  });

  if (health.ready) {
    const secs = (health.elapsed / 1000).toFixed(1);
    process.stdout.write(`\r  ${green(symbols.tick)} Server ready ${dim(`(${secs}s)`)}            \n`);
  } else if (!isProcessAlive(newSession.pid)) {
    process.stdout.write(`\r  ${red(symbols.cross)} Process exited — check logs            \n`);
  } else {
    process.stdout.write(`\r  ${yellow(symbols.warning)} Server not responding yet ${dim('(may still be starting)')}  \n`);
  }
}

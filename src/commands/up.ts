import { findProjectRoot, loadConfig, getPortForBranch, rememberPort } from '../lib/config.js';
import { findAvailablePort, isPortAvailable } from '../lib/ports.js';
import { getSession, isProcessAlive } from '../lib/registry.js';
import { ensureWorktree, getCurrentBranch } from '../lib/worktree.js';
import { spawnSession } from '../lib/process-manager.js';
import { logFilePath } from '../lib/paths.js';
import { bold, green, cyan, yellow, dim, gray, symbols } from '../lib/colors.js';
import { execSync } from 'node:child_process';

interface UpOptions {
  port?: string;
  command?: string;
  sameWorktree?: boolean;
  name?: string;
  env?: string[];
}

export async function up(branchOrName: string | undefined, opts: UpOptions): Promise<void> {
  const projectRoot = findProjectRoot();
  const config = loadConfig(projectRoot);

  // Show what was detected on first run
  console.log(`${dim(symbols.arrow)} Project: ${bold(config.name)} ${gray(`(${config.packageManager})`)}`);
  console.log(`${dim(symbols.arrow)} Command: ${gray(config.command)}`);

  // Determine branch
  const branch = branchOrName || getCurrentBranch(projectRoot);
  const sessionId = opts.name || branch.replace(/\//g, '-');

  // Check if session already exists and is running
  const existing = getSession(sessionId);
  if (existing && isProcessAlive(existing.pid)) {
    console.log(`\n${yellow(symbols.warning)} Session ${bold(sessionId)} is already running`);
    console.log(`  Port: ${cyan(String(existing.port))}`);
    console.log(`  PID:  ${dim(String(existing.pid))}`);
    console.log(`  Dir:  ${dim(existing.worktreeDir)}`);
    return;
  }

  // Resolve port: explicit flag > remembered > auto-assign
  let port: number;
  if (opts.port) {
    port = parseInt(opts.port, 10);
    if (!(await isPortAvailable(port))) {
      console.error(`${bold(symbols.cross)} Port ${port} is not available`);
      process.exit(1);
    }
  } else {
    const remembered = getPortForBranch(config, branch);
    if (remembered && (await isPortAvailable(remembered))) {
      port = remembered;
      console.log(`${dim(symbols.arrow)} Reusing remembered port ${cyan(String(port))} for ${bold(branch)}`);
    } else {
      port = await findAvailablePort(config.portRange);
    }
  }

  // Remember this port for next time
  rememberPort(config, branch, port, projectRoot);

  // Resolve working directory
  let worktreeDir: string;
  const sameWorktree = opts.sameWorktree || false;

  if (sameWorktree) {
    worktreeDir = projectRoot;
    console.log(`${dim(symbols.arrow)} Using same worktree`);
  } else {
    console.log(`${dim(symbols.arrow)} Setting up worktree for ${bold(branch)}...`);
    const wt = ensureWorktree(branch, projectRoot, config);
    worktreeDir = wt.path;

    if (wt.isNew) {
      console.log(`${green(symbols.tick)} Created worktree at ${dim(wt.path)}`);
      if (config.postCreate) {
        console.log(`${dim(symbols.arrow)} Running: ${config.postCreate}`);
        try {
          execSync(config.postCreate, { cwd: worktreeDir, stdio: 'inherit' });
        } catch {
          console.error(`${yellow(symbols.warning)} Post-create command failed, continuing anyway`);
        }
      }
    } else {
      console.log(`${dim(symbols.arrow)} Reusing existing worktree`);
    }
  }

  // Parse extra env vars
  const extraEnv: Record<string, string> = { ...config.env };
  if (opts.env) {
    for (const e of opts.env) {
      const [key, ...rest] = e.split('=');
      if (key && rest.length > 0) {
        extraEnv[key] = rest.join('=');
      }
    }
  }

  // Spawn the session
  const command = opts.command || config.command;

  const session = spawnSession({
    id: sessionId,
    branch,
    worktreeDir,
    port,
    projectRoot,
    command,
    sameWorktree,
    env: extraEnv,
  });

  console.log('');
  console.log(`${green(symbols.tick)} Session ${bold(sessionId)} started`);
  console.log('');
  console.log(`  ${bold('URL')}:    ${cyan(`http://localhost:${port}`)}`);
  console.log(`  ${bold('PID')}:    ${dim(String(session.pid))}`);
  console.log(`  ${bold('Branch')}: ${branch}`);
  console.log(`  ${bold('Dir')}:    ${dim(worktreeDir)}`);
  console.log(`  ${bold('Logs')}:   ${dim(logFilePath(sessionId))}`);
  console.log('');
  console.log(`  ${dim(`devmux logs ${sessionId}`)}  — tail logs`);
  console.log(`  ${dim(`devmux down ${sessionId}`)} — stop session`);
}

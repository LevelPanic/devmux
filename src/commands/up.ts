import { findProjectRoot, loadConfig, getPortForBranch, rememberPort, getService, getServiceNames } from '../lib/config.js';
import { findAvailablePort, isPortAvailable } from '../lib/ports.js';
import { getSession, isProcessAlive } from '../lib/registry.js';
import { ensureWorktree, getCurrentBranch } from '../lib/worktree.js';
import { spawnSession } from '../lib/process-manager.js';
import { waitForReady } from '../lib/health.js';
import { logFilePath, configFileName } from '../lib/paths.js';
import { bold, green, cyan, yellow, red, dim, gray, symbols } from '../lib/colors.js';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

interface UpOptions {
  port?: string;
  command?: string;
  sameWorktree?: boolean;
  name?: string;
  service?: string;
  env?: string[];
}

export async function up(branchOrName: string | undefined, opts: UpOptions): Promise<void> {
  const projectRoot = findProjectRoot();
  const config = loadConfig(projectRoot);

  // Resolve service config if --service is used
  const serviceConfig = opts.service ? getService(config, opts.service) : undefined;
  if (opts.service && !serviceConfig) {
    const available = getServiceNames(config);
    console.error(`${red(symbols.cross)} Service ${bold(opts.service)} not found`);
    if (available.length > 0) {
      console.log(`  Available services: ${available.map((s) => cyan(s)).join(', ')}`);
    } else {
      console.log(`  No services configured. Add them to .devmux.json under "services"`);
    }
    process.exit(1);
  }

  // Show what was detected
  const displayCommand = opts.command || serviceConfig?.command || config.command;
  console.log(`${dim(symbols.arrow)} Project: ${bold(config.name)} ${gray(`(${config.packageManager})`)}`);
  console.log(`${dim(symbols.arrow)} Command: ${gray(displayCommand)}`);
  if (opts.service) {
    console.log(`${dim(symbols.arrow)} Service: ${cyan(opts.service)}${serviceConfig?.cwd ? ` ${gray(`(${serviceConfig.cwd})`)}` : ''}`);
  }

  // One-time .gitignore hint
  const gitignorePath = join(projectRoot, '.gitignore');
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, 'utf-8');
    if (!content.split('\n').some((l) => l.trim() === '.devmux.json')) {
      console.log(`${dim(symbols.arrow)} ${yellow('Tip')}: add ${dim('.devmux.json')} to .gitignore (port mappings are machine-specific)`);
    }
  }

  // Determine branch
  const branch = branchOrName || getCurrentBranch(projectRoot);

  // Session ID: service-aware naming
  let sessionId: string;
  if (opts.name) {
    sessionId = opts.name;
  } else if (opts.service) {
    sessionId = `${branch.replace(/\//g, '-')}:${opts.service}`;
  } else {
    sessionId = branch.replace(/\//g, '-');
  }

  // Check if session already exists and is running
  const existing = getSession(sessionId);
  if (existing && isProcessAlive(existing.pid)) {
    console.log(`\n${yellow(symbols.warning)} Session ${bold(sessionId)} is already running`);
    console.log(`  Port: ${cyan(String(existing.port))}`);
    console.log(`  PID:  ${dim(String(existing.pid))}`);
    console.log(`  Dir:  ${dim(existing.worktreeDir)}`);
    return;
  }

  // Resolve port: explicit flag > service default > remembered > auto-assign
  let port: number;
  if (opts.port) {
    port = parseInt(opts.port, 10);
    if (!(await isPortAvailable(port))) {
      console.error(`${bold(symbols.cross)} Port ${port} is not available`);
      process.exit(1);
    }
  } else if (serviceConfig?.port && (await isPortAvailable(serviceConfig.port))) {
    port = serviceConfig.port;
    console.log(`${dim(symbols.arrow)} Using service default port ${cyan(String(port))}`);
  } else {
    const portKey = opts.service ? `${branch}:${opts.service}` : branch;
    const remembered = getPortForBranch(config, portKey);
    if (remembered && (await isPortAvailable(remembered))) {
      port = remembered;
      console.log(`${dim(symbols.arrow)} Reusing remembered port ${cyan(String(port))}`);
    } else {
      port = await findAvailablePort(config.portRange);
    }
  }

  // Remember this port
  const portKey = opts.service ? `${branch}:${opts.service}` : branch;
  rememberPort(config, portKey, port, projectRoot);

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

  // If service has a cwd, resolve it relative to the worktree
  let serviceCwd = worktreeDir;
  if (serviceConfig?.cwd) {
    serviceCwd = resolve(worktreeDir, serviceConfig.cwd);
  }

  // Parse extra env vars: config.env < service.env < --env flags
  const extraEnv: Record<string, string> = {
    ...config.env,
    ...(serviceConfig?.env || {}),
  };
  if (opts.env) {
    for (const e of opts.env) {
      const [key, ...rest] = e.split('=');
      if (key && rest.length > 0) {
        extraEnv[key] = rest.join('=');
      }
    }
  }

  // Spawn the session
  const command = opts.command || serviceConfig?.command || config.command;

  const session = spawnSession({
    id: sessionId,
    branch,
    worktreeDir: serviceCwd,
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
  console.log(`  ${bold('Dir')}:    ${dim(serviceCwd)}`);
  console.log(`  ${bold('Logs')}:   ${dim(logFilePath(sessionId))}`);

  // Health check — wait for server to accept connections
  process.stdout.write(`\n  ${dim('Waiting for server...')} `);
  const health = await waitForReady(port, session.pid, 30000, (elapsed) => {
    const secs = Math.floor(elapsed / 1000);
    process.stdout.write(`\r  ${dim('Waiting for server...')} ${dim(`${secs}s`)} `);
  });

  if (health.ready) {
    const secs = (health.elapsed / 1000).toFixed(1);
    process.stdout.write(`\r  ${green(symbols.tick)} Server ready ${dim(`(${secs}s)`)}            \n`);
  } else if (!isProcessAlive(session.pid)) {
    process.stdout.write(`\r  ${red(symbols.cross)} Process exited — check logs            \n`);
  } else {
    process.stdout.write(`\r  ${yellow(symbols.warning)} Server not responding yet ${dim('(may still be starting)')}  \n`);
  }

  console.log('');
  console.log(`  ${dim(`devmux logs ${sessionId}`)}    — tail logs`);
  console.log(`  ${dim(`devmux attach ${sessionId}`)}  — attach to output`);
  console.log(`  ${dim(`devmux down ${sessionId}`)}   — stop session`);
}

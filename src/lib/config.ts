import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { configFileName } from './paths.js';

export interface PortMapping {
  branch: string;
  port: number;
}

export interface ServiceConfig {
  /** Command to start this service */
  command: string;
  /** Subdirectory relative to project root (e.g., "apps/Admanage") */
  cwd?: string;
  /** Default port for this service */
  port?: number;
  /** Extra env vars for this service */
  env?: Record<string, string>;
}

export interface DevmuxConfig {
  /** Auto-detected project name */
  name: string;
  /** Command to start the dev server */
  command: string;
  /** Detected package manager */
  packageManager: 'pnpm' | 'npm' | 'yarn' | 'bun';
  /** Port range [min, max] for auto-assignment */
  portRange: [number, number];
  /** Directory for worktrees, relative to project root */
  worktreeDir: string;
  /** Extra environment variables to pass to all sessions */
  env: Record<string, string>;
  /** Command to run after creating a worktree */
  postCreate: string;
  /** Next.js distDir env var name */
  distDirEnv: string;
  /** Remembered port assignments per branch */
  ports: PortMapping[];
  /** Named services for monorepos — each can be started individually */
  services: Record<string, ServiceConfig>;
}

export function findProjectRoot(from: string = process.cwd()): string {
  let dir = resolve(from);
  let prev = '';
  while (dir !== prev) {
    if (
      existsSync(join(dir, 'package.json')) &&
      (existsSync(join(dir, '.git')) || existsSync(join(dir, configFileName())))
    ) {
      return dir;
    }
    prev = dir;
    dir = resolve(dir, '..');
  }
  return process.cwd();
}

/** Detect package manager from lockfiles */
function detectPackageManager(projectRoot: string): 'pnpm' | 'npm' | 'yarn' | 'bun' {
  if (existsSync(join(projectRoot, 'pnpm-lock.yaml')) || existsSync(join(projectRoot, 'pnpm-workspace.yaml'))) return 'pnpm';
  if (existsSync(join(projectRoot, 'bun.lockb')) || existsSync(join(projectRoot, 'bun.lock'))) return 'bun';
  if (existsSync(join(projectRoot, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

/** Detect the best dev command from package.json scripts */
function detectDevCommand(projectRoot: string, pm: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf-8'));
    const scripts = pkg.scripts || {};

    const candidates = ['dev:web', 'dev:app', 'dev:next', 'dev', 'start:dev', 'start'];
    for (const name of candidates) {
      if (scripts[name]) {
        return `${pm} run ${name}`;
      }
    }
  } catch {
    // ignore
  }
  return `${pm} run dev`;
}

/** Auto-detect monorepo workspace apps that have dev scripts */
function detectServices(projectRoot: string, pm: string): Record<string, ServiceConfig> {
  const services: Record<string, ServiceConfig> = {};

  // Check common monorepo app directories
  const appDirs = ['apps', 'packages'];
  for (const appDir of appDirs) {
    const appsPath = join(projectRoot, appDir);
    if (!existsSync(appsPath)) continue;

    try {
      const entries = readdirSync(appsPath);

      for (const entry of entries) {
        try {
          const entryPath = join(appsPath, entry);
          const pkgPath = join(entryPath, 'package.json');

          if (!statSync(entryPath).isDirectory() || !existsSync(pkgPath)) continue;

          const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
          const scripts = pkg.scripts || {};

          const devScript = ['dev', 'dev:web', 'start:dev', 'start'].find((s) => scripts[s]);
          if (devScript) {
            const name = pkg.name?.replace(/^@[^/]+\//, '') || entry;
            services[name] = {
              command: `${pm} run ${devScript}`,
              cwd: `${appDir}/${entry}`,
            };
          }
        } catch {
          // Skip broken symlinks, unreadable packages, etc.
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  return services;
}

/** Build config from repo detection */
function detectConfig(projectRoot: string): DevmuxConfig {
  const pm = detectPackageManager(projectRoot);
  const command = detectDevCommand(projectRoot, pm);
  const services = detectServices(projectRoot, pm);

  let projectName: string;
  try {
    const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf-8'));
    projectName = pkg.name || basename(projectRoot);
  } catch {
    projectName = basename(projectRoot);
  }

  return {
    name: projectName,
    command,
    packageManager: pm,
    portRange: [3000, 3099],
    worktreeDir: '../devmux-worktrees',
    env: {},
    postCreate: `${pm} install`,
    distDirEnv: 'NEXT_DIST_DIR',
    ports: [],
    services,
  };
}

/** Get a service config by name */
export function getService(config: DevmuxConfig, name: string): ServiceConfig | undefined {
  return config.services?.[name];
}

/** List available service names */
export function getServiceNames(config: DevmuxConfig): string[] {
  return Object.keys(config.services || {});
}

/** Load config — auto-creates from repo detection if no config file exists */
export function loadConfig(projectRoot?: string): DevmuxConfig {
  const root = projectRoot || findProjectRoot();
  const configPath = join(root, configFileName());

  if (!existsSync(configPath)) {
    const config = detectConfig(root);
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    return config;
  }

  try {
    const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
    const detected = detectConfig(root);
    return { ...detected, ...raw, ports: raw.ports || [], services: { ...detected.services, ...(raw.services || {}) } };
  } catch (e) {
    // Don't silently overwrite — warn and use detected defaults in-memory only
    console.error(`Warning: .devmux.json has invalid JSON, using auto-detected config`);
    console.error(`  Fix the file or delete it to regenerate: ${configPath}`);
    return detectConfig(root);
  }
}

/** Save config back to disk */
export function saveConfig(config: DevmuxConfig, projectRoot?: string): void {
  const root = projectRoot || findProjectRoot();
  const configPath = join(root, configFileName());
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

/** Get remembered port for a branch, or undefined */
export function getPortForBranch(config: DevmuxConfig, branch: string): number | undefined {
  const mapping = config.ports.find((p) => p.branch === branch);
  return mapping?.port;
}

/** Remember a port assignment for a branch */
export function rememberPort(config: DevmuxConfig, branch: string, port: number, projectRoot?: string): void {
  config.ports = config.ports.filter((p) => p.branch !== branch);
  config.ports.push({ branch, port });
  saveConfig(config, projectRoot);
}

/** Forget a port assignment */
export function forgetPort(config: DevmuxConfig, branch: string, projectRoot?: string): void {
  config.ports = config.ports.filter((p) => p.branch !== branch);
  saveConfig(config, projectRoot);
}

export function resolveWorktreeBase(projectRoot: string, config: DevmuxConfig): string {
  return resolve(projectRoot, config.worktreeDir);
}

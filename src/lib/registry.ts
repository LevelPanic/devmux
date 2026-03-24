import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { registryPath, ensureDevmuxHome } from './paths.js';
import { dirname, join } from 'node:path';
import { acquireLock } from './lockfile.js';

export interface Session {
  id: string;
  branch: string;
  worktreeDir: string;
  port: number;
  pid: number;
  projectRoot: string;
  command: string;
  sameWorktree: boolean;
  startedAt: string;
  env: Record<string, string>;
}

export interface Registry {
  sessions: Session[];
}

function empty(): Registry {
  return { sessions: [] };
}

export function loadRegistry(): Registry {
  const p = registryPath();
  if (!existsSync(p)) return empty();
  try {
    const data = JSON.parse(readFileSync(p, 'utf-8'));
    return { sessions: data.sessions || [] };
  } catch {
    return empty();
  }
}

/** Atomic write — write to temp file then rename to avoid corruption */
function saveRegistryUnsafe(registry: Registry): void {
  const p = registryPath();
  const dir = dirname(p);
  ensureDevmuxHome();
  const tmp = join(dir, `.registry.${process.pid}.tmp`);
  writeFileSync(tmp, JSON.stringify(registry, null, 2) + '\n');
  renameSync(tmp, p);
}

/** Save registry with file lock for concurrent write safety */
export function saveRegistry(registry: Registry): void {
  const release = acquireLock();
  try {
    saveRegistryUnsafe(registry);
  } finally {
    release();
  }
}

/** Locked read-modify-write helper */
function withRegistry<T>(fn: (reg: Registry) => T): T {
  const release = acquireLock();
  try {
    const reg = loadRegistry();
    const result = fn(reg);
    saveRegistryUnsafe(reg);
    return result;
  } finally {
    release();
  }
}

export function addSession(session: Session): void {
  withRegistry((reg) => {
    reg.sessions = reg.sessions.filter((s) => s.id !== session.id);
    reg.sessions.push(session);
  });
}

export function removeSession(id: string): Session | undefined {
  let found: Session | undefined;
  withRegistry((reg) => {
    found = reg.sessions.find((s) => s.id === id);
    if (found) {
      reg.sessions = reg.sessions.filter((s) => s.id !== id);
    }
  });
  return found;
}

export function getSession(id: string): Session | undefined {
  return loadRegistry().sessions.find((s) => s.id === id);
}

export function getSessions(): Session[] {
  return loadRegistry().sessions;
}

export function getSessionsByProject(projectRoot: string): Session[] {
  return loadRegistry().sessions.filter((s) => s.projectRoot === projectRoot);
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Remove dead sessions from registry and return them */
export function pruneDeadSessions(): Session[] {
  const dead: Session[] = [];
  withRegistry((reg) => {
    const alive: Session[] = [];
    for (const session of reg.sessions) {
      if (isProcessAlive(session.pid)) {
        alive.push(session);
      } else {
        dead.push(session);
      }
    }
    reg.sessions = alive;
  });
  return dead;
}

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { registryPath } from './paths.js';

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

export function saveRegistry(registry: Registry): void {
  writeFileSync(registryPath(), JSON.stringify(registry, null, 2) + '\n');
}

export function addSession(session: Session): void {
  const reg = loadRegistry();
  // Remove any existing session with same ID
  reg.sessions = reg.sessions.filter((s) => s.id !== session.id);
  reg.sessions.push(session);
  saveRegistry(reg);
}

export function removeSession(id: string): Session | undefined {
  const reg = loadRegistry();
  const session = reg.sessions.find((s) => s.id === id);
  if (session) {
    reg.sessions = reg.sessions.filter((s) => s.id !== id);
    saveRegistry(reg);
  }
  return session;
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
  const reg = loadRegistry();
  const dead: Session[] = [];
  const alive: Session[] = [];

  for (const session of reg.sessions) {
    if (isProcessAlive(session.pid)) {
      alive.push(session);
    } else {
      dead.push(session);
    }
  }

  if (dead.length > 0) {
    reg.sessions = alive;
    saveRegistry(reg);
  }

  return dead;
}

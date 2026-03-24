import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';

const DEVMUX_HOME = join(homedir(), '.devmux');

export function ensureDevmuxHome(): string {
  if (!existsSync(DEVMUX_HOME)) {
    mkdirSync(DEVMUX_HOME, { recursive: true });
  }
  return DEVMUX_HOME;
}

export function registryPath(): string {
  return join(ensureDevmuxHome(), 'registry.json');
}

export function logsDir(): string {
  const dir = join(ensureDevmuxHome(), 'logs');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function logFilePath(sessionId: string): string {
  return join(logsDir(), `${sessionId}.log`);
}

export function configFileName(): string {
  return '.devmux.json';
}

import { writeFileSync, unlinkSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { registryPath } from './paths.js';

const LOCK_STALE_MS = 10000;

function lockPath(): string {
  return registryPath() + '.lock';
}

interface LockContent {
  pid: number;
  timestamp: number;
}

function isLockStale(lock: LockContent): boolean {
  try {
    process.kill(lock.pid, 0);
  } catch {
    return true;
  }
  return Date.now() - lock.timestamp > LOCK_STALE_MS;
}

/** Synchronous sleep without busy-wait or subprocess */
function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Acquire a simple file-based lock.
 * Spins up to `timeoutMs` waiting for the lock.
 * Returns a release function.
 */
export function acquireLock(timeoutMs: number = 5000): () => void {
  const lp = lockPath();
  const dir = dirname(lp);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const start = Date.now();

  while (true) {
    // Clean stale locks
    if (existsSync(lp)) {
      try {
        const content: LockContent = JSON.parse(readFileSync(lp, 'utf-8'));
        if (isLockStale(content)) {
          try { unlinkSync(lp); } catch { /* race */ }
        }
      } catch {
        try { unlinkSync(lp); } catch { /* race */ }
      }
    }

    // Try to create lock (O_EXCL = fail if exists)
    try {
      const content: LockContent = { pid: process.pid, timestamp: Date.now() };
      writeFileSync(lp, JSON.stringify(content), { flag: 'wx' });
      return () => {
        try { unlinkSync(lp); } catch { /* already removed */ }
      };
    } catch {
      // Lock held by another process
    }

    if (Date.now() - start > timeoutMs) {
      console.error('Warning: could not acquire registry lock, proceeding anyway');
      return () => {};
    }

    sleepMs(50);
  }
}

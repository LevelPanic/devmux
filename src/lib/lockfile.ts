import { writeFileSync, unlinkSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { registryPath } from './paths.js';

const LOCK_STALE_MS = 10000; // 10 seconds — if a lock is older than this, it's stale

function lockPath(): string {
  return registryPath() + '.lock';
}

interface LockContent {
  pid: number;
  timestamp: number;
}

function isLockStale(lock: LockContent): boolean {
  // Check if the process that holds the lock is still alive
  try {
    process.kill(lock.pid, 0);
  } catch {
    return true; // Process is dead — lock is stale
  }
  // Check if lock is too old
  return Date.now() - lock.timestamp > LOCK_STALE_MS;
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
    // Try to detect and clean up stale locks
    if (existsSync(lp)) {
      try {
        const content: LockContent = JSON.parse(readFileSync(lp, 'utf-8'));
        if (isLockStale(content)) {
          // Stale lock — remove it
          try { unlinkSync(lp); } catch { /* race with another process */ }
        }
      } catch {
        // Corrupted lock file — remove it
        try { unlinkSync(lp); } catch { /* race */ }
      }
    }

    // Try to create lock file (atomic on most filesystems via O_EXCL)
    try {
      const content: LockContent = { pid: process.pid, timestamp: Date.now() };
      writeFileSync(lp, JSON.stringify(content), { flag: 'wx' }); // wx = write exclusive (fail if exists)
      // Lock acquired
      return () => {
        try { unlinkSync(lp); } catch { /* already removed */ }
      };
    } catch {
      // Lock exists and is held by another process
    }

    if (Date.now() - start > timeoutMs) {
      // Timeout — proceed without lock (better than deadlocking)
      return () => {};
    }

    // Spin wait — short sleep via busy loop (synchronous, no async needed)
    const spinUntil = Date.now() + 50;
    while (Date.now() < spinUntil) { /* spin */ }
  }
}

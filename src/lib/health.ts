import { createConnection } from 'node:net';
import { isProcessAlive } from './registry.js';

/** Check if a port is accepting connections */
function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' });
    socket.setTimeout(500);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => {
      resolve(false);
    });
  });
}

export interface WaitResult {
  ready: boolean;
  elapsed: number;
}

/**
 * Poll until a port accepts connections or timeout.
 * Also checks that the process is still alive — returns early if it dies.
 */
export async function waitForReady(
  port: number,
  pid: number,
  timeoutMs: number = 30000,
  onTick?: (elapsed: number) => void,
): Promise<WaitResult> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    // Check process is still alive
    if (!isProcessAlive(pid)) {
      return { ready: false, elapsed: Date.now() - start };
    }

    if (await checkPort(port)) {
      return { ready: true, elapsed: Date.now() - start };
    }

    if (onTick) {
      onTick(Date.now() - start);
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  return { ready: false, elapsed: Date.now() - start };
}

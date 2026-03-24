import { createServer } from 'node:net';
import { loadRegistry } from './registry.js';

/** Check if a port is available */
function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

/** Find next available port in range, skipping ports already in registry */
export async function findAvailablePort(range: [number, number]): Promise<number> {
  const [min, max] = range;
  const registry = loadRegistry();
  const usedPorts = new Set(registry.sessions.map((s) => s.port));

  for (let port = min; port <= max; port++) {
    if (usedPorts.has(port)) continue;
    if (await isPortFree(port)) return port;
  }

  throw new Error(`No available ports in range ${min}-${max}`);
}

/** Check if a specific port is available (not in registry and not in use) */
export async function isPortAvailable(port: number): Promise<boolean> {
  const registry = loadRegistry();
  if (registry.sessions.some((s) => s.port === port)) return false;
  return isPortFree(port);
}

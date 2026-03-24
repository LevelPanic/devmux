import { watch } from 'node:fs/promises';
import { open } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { getSessionsByProject, getSessions, isProcessAlive, type Session } from '../lib/registry.js';
import { findProjectRoot } from '../lib/config.js';
import { logFilePath, registryPath } from '../lib/paths.js';
import { bold, green, red, cyan, dim, yellow, gray, symbols } from '../lib/colors.js';

interface ShowOptions {
  all?: boolean;
}

// Color cycle for session prefixes
const prefixColors = [cyan, green, yellow, red, bold];

interface TrackedSession {
  session: Session;
  position: number;
  color: (s: string) => string;
  watcher: AsyncIterable<any> | null;
  alive: boolean;
}

function formatPrefix(name: string, color: (s: string) => string, maxLen: number): string {
  const padded = name.padEnd(maxLen);
  return color(`[${padded}]`);
}

function printStatusBar(tracked: Map<string, TrackedSession>, maxLen: number): void {
  const parts = Array.from(tracked.values()).map((t) => {
    const status = t.alive ? green(symbols.bullet) : red(symbols.bullet);
    const port = dim(`:${t.session.port}`);
    return `${t.color(t.session.id)}${port} ${status}`;
  });
  process.stdout.write(`\r\x1b[K${dim('─── ')}${parts.join(dim(' │ '))}${dim(' ───')}\n`);
}

export async function show(opts: ShowOptions): Promise<void> {
  const projectRoot = opts.all ? undefined : findProjectRoot();
  const ac = new AbortController();

  // Track active watchers
  const tracked = new Map<string, TrackedSession>();
  let colorIndex = 0;
  let maxPrefixLen = 0;

  function getColor(): (s: string) => string {
    const color = prefixColors[colorIndex % prefixColors.length];
    colorIndex++;
    return color;
  }

  /** Start tailing a session's log file */
  async function tailSession(ts: TrackedSession): Promise<void> {
    const logFile = logFilePath(ts.session.id);

    // Wait for log file to appear
    let waitCount = 0;
    while (!existsSync(logFile) && waitCount < 60) {
      await new Promise((r) => setTimeout(r, 500));
      if (ac.signal.aborted) return;
      waitCount++;
    }
    if (!existsSync(logFile)) return;

    // Print last few lines for context
    const content = readFileSync(logFile, 'utf-8');
    const lines = content.split('\n').filter((l) => l.length > 0);
    const recent = lines.slice(-5);
    for (const line of recent) {
      const prefix = formatPrefix(ts.session.id, ts.color, maxPrefixLen);
      process.stdout.write(`${prefix} ${line}\n`);
    }
    ts.position = Buffer.byteLength(content, 'utf-8');

    // Watch for new content
    try {
      const watcher = watch(logFile, { signal: ac.signal });
      for await (const _ of watcher) {
        const fh = await open(logFile, 'r');
        try {
          const stat = await fh.stat();
          if (stat.size > ts.position) {
            const buf = Buffer.alloc(stat.size - ts.position);
            await fh.read(buf, 0, buf.length, ts.position);
            const newContent = buf.toString('utf-8');
            const newLines = newContent.split('\n');

            for (const line of newLines) {
              if (line.length === 0) continue;
              const prefix = formatPrefix(ts.session.id, ts.color, maxPrefixLen);
              process.stdout.write(`${prefix} ${line}\n`);
            }
            ts.position = stat.size;
          } else if (stat.size < ts.position) {
            ts.position = 0; // File truncated
          }
        } finally {
          await fh.close();
        }
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        const prefix = formatPrefix(ts.session.id, ts.color, maxPrefixLen);
        process.stdout.write(`${prefix} ${dim('(log watcher ended)')}\n`);
      }
    }
  }

  /** Scan registry for new/removed sessions */
  function refreshSessions(): void {
    const sessions = projectRoot
      ? getSessionsByProject(projectRoot)
      : getSessions();

    // Check for new sessions
    for (const session of sessions) {
      if (!tracked.has(session.id)) {
        const color = getColor();
        const ts: TrackedSession = {
          session,
          position: 0,
          color,
          watcher: null,
          alive: isProcessAlive(session.pid),
        };

        // Recalculate max prefix length
        maxPrefixLen = Math.max(maxPrefixLen, session.id.length);

        tracked.set(session.id, ts);

        const prefix = formatPrefix(session.id, color, maxPrefixLen);
        process.stdout.write(`${prefix} ${green(symbols.tick)} Session started (port ${cyan(String(session.port))})\n`);

        // Start tailing in background
        tailSession(ts).catch(() => {});
      }
    }

    // Check for dead/removed sessions
    const activeIds = new Set(sessions.map((s) => s.id));
    for (const [id, ts] of tracked) {
      const wasAlive = ts.alive;
      ts.alive = activeIds.has(id) && isProcessAlive(ts.session.pid);

      if (wasAlive && !ts.alive) {
        const prefix = formatPrefix(id, ts.color, maxPrefixLen);
        process.stdout.write(`${prefix} ${red(symbols.cross)} Session exited\n`);
      }
    }
  }

  // Initial header
  const scope = opts.all ? 'all projects' : 'this project';
  console.log(`${bold('devmux show')} ${dim(`(${scope})`)}`);
  console.log(`${dim('Streaming logs from all sessions. Ctrl+C to exit.')}`);
  console.log(`${dim('Use another terminal to run devmux up/down/restart.')}\n`);

  // Initial scan
  refreshSessions();

  if (tracked.size === 0) {
    console.log(`${dim('No active sessions. Start one with:')} devmux up <branch>`);
    console.log(`${dim('Waiting for sessions...')}\n`);
  }

  // Poll registry for changes every 3 seconds
  const registryPoll = setInterval(() => {
    refreshSessions();
  }, 3000);

  // Handle Ctrl+C
  process.on('SIGINT', () => {
    clearInterval(registryPoll);
    ac.abort();
    console.log(`\n${dim('Detached from all sessions (still running)')}`);
    process.exit(0);
  });

  // Keep alive
  await new Promise(() => {});
}

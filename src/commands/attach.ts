import { open, watch } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { getSession, isProcessAlive } from '../lib/registry.js';
import { logFilePath } from '../lib/paths.js';
import { bold, red, yellow, green, cyan, dim, symbols } from '../lib/colors.js';

export async function attach(sessionId: string): Promise<void> {
  const session = getSession(sessionId);
  if (!session) {
    console.error(`${red(symbols.cross)} Session ${bold(sessionId)} not found`);
    console.log(`${dim('Run')} devmux ls ${dim('to see active sessions')}`);
    process.exit(1);
  }

  const alive = isProcessAlive(session.pid);
  const status = alive
    ? `${green(symbols.bullet)} running`
    : `${red(symbols.bullet)} dead`;

  console.log(`${bold('Attached to')} ${bold(sessionId)} ${status}`);
  console.log(`  Port: ${cyan(String(session.port))}  PID: ${dim(String(session.pid))}  Branch: ${session.branch}`);
  console.log(`${dim('Press Ctrl+C to detach')}\n`);

  const logFile = logFilePath(sessionId);

  if (!existsSync(logFile)) {
    console.log(`${dim('Waiting for output...')}\n`);
  } else {
    // Print recent output to give context
    const content = readFileSync(logFile, 'utf-8');
    const lines = content.split('\n');
    const trimmed = lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;
    const recent = trimmed.slice(-20);
    if (recent.length > 0) {
      process.stdout.write(recent.join('\n') + '\n');
    }
  }

  // Stream new output
  let position = existsSync(logFile) ? readFileSync(logFile).length : 0;
  const ac = new AbortController();

  // Monitor process health
  const healthCheck = setInterval(() => {
    if (!isProcessAlive(session.pid)) {
      console.log(`\n${red(symbols.cross)} Process exited`);
      clearInterval(healthCheck);
      ac.abort();
      process.exit(1);
    }
  }, 2000);

  process.on('SIGINT', () => {
    clearInterval(healthCheck);
    ac.abort();
    console.log(`\n${dim('Detached from')} ${bold(sessionId)} ${dim('(session still running)')}`);
    process.exit(0);
  });

  try {
    // Wait for log file to appear if it doesn't exist yet
    while (!existsSync(logFile)) {
      await new Promise((r) => setTimeout(r, 200));
      if (ac.signal.aborted) return;
    }

    const watcher = watch(logFile, { signal: ac.signal });
    for await (const _ of watcher) {
      const fh = await open(logFile, 'r');
      try {
        const stat = await fh.stat();
        if (stat.size > position) {
          const buf = Buffer.alloc(stat.size - position);
          await fh.read(buf, 0, buf.length, position);
          process.stdout.write(buf);
          position = stat.size;
        } else if (stat.size < position) {
          position = 0;
        }
      } finally {
        await fh.close();
      }
    }
  } catch (e: any) {
    if (e.name !== 'AbortError') throw e;
  }
}

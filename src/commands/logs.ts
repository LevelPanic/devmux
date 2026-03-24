import { open, watch } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { getSession } from '../lib/registry.js';
import { logFilePath } from '../lib/paths.js';
import { bold, red, dim, symbols } from '../lib/colors.js';

interface LogsOptions {
  follow?: boolean;
  lines?: string;
}

/** Read last N lines from a file (pure Node, no `tail` dependency) */
function readLastLines(filePath: string, count: number): string {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  // If file ends with newline, last element is empty
  const trimmed = lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;
  return trimmed.slice(-count).join('\n');
}

export async function logs(sessionId: string, opts: LogsOptions): Promise<void> {
  const session = getSession(sessionId);
  if (!session) {
    console.error(`${red(symbols.cross)} Session ${bold(sessionId)} not found`);
    process.exit(1);
  }

  const logFile = logFilePath(sessionId);
  if (!existsSync(logFile)) {
    console.log(`${dim('No logs yet for')} ${bold(sessionId)}`);
    return;
  }

  const lineCount = parseInt(opts.lines || '50', 10);
  const follow = opts.follow !== false;

  console.log(`${dim(`Logs for ${bold(sessionId)} (${logFile}):`)}\n`);

  // Print last N lines
  const lastLines = readLastLines(logFile, lineCount);
  if (lastLines) process.stdout.write(lastLines + '\n');

  if (!follow) return;

  // Follow mode — watch file for changes and stream new content
  let position = readFileSync(logFile).length;

  const ac = new AbortController();

  process.on('SIGINT', () => {
    ac.abort();
    process.exit(0);
  });

  try {
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
          // File was truncated — reset
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

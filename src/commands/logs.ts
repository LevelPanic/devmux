import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { getSession } from '../lib/registry.js';
import { logFilePath } from '../lib/paths.js';
import { bold, red, dim, symbols } from '../lib/colors.js';

interface LogsOptions {
  follow?: boolean;
  lines?: string;
}

export function logs(sessionId: string, opts: LogsOptions): void {
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

  const lines = opts.lines || '50';
  const follow = opts.follow !== false; // default true

  console.log(`${dim(`Logs for ${bold(sessionId)} (${logFile}):`)}\n`);

  const args = ['-n', lines];
  if (follow) args.push('-f');
  args.push(logFile);

  const tail = spawn('tail', args, { stdio: 'inherit' });

  process.on('SIGINT', () => {
    tail.kill();
    process.exit(0);
  });

  tail.on('exit', (code) => {
    process.exit(code || 0);
  });
}

import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

const program = new Command();

program
  .name('devmux')
  .description('Run multiple Next.js dev sessions across git worktrees')
  .version(pkg.version);

program
  .command('up [branch]')
  .description('Start a dev session for a branch (creates a worktree if needed)')
  .option('-p, --port <port>', 'Use a specific port instead of auto-assigning')
  .option('-c, --command <cmd>', 'Override the dev command')
  .option('-s, --same-worktree', 'Run in the current directory (no worktree, uses separate .next dir)')
  .option('-n, --name <name>', 'Custom session name (defaults to branch name)')
  .option('--service <name>', 'Run a specific service from the services config (monorepo)')
  .option('-e, --env <KEY=VALUE...>', 'Extra environment variables', (v, prev: string[]) => [...prev, v], [])
  .action(async (branch, opts) => {
    const { up } = await import('./commands/up.js');
    await up(branch, opts);
  });

program
  .command('down [session]')
  .description('Stop a running session')
  .option('-a, --all', 'Stop all sessions')
  .action(async (session, opts) => {
    const { down } = await import('./commands/down.js');
    await down(session, opts);
  });

program
  .command('ls')
  .alias('list')
  .description('List active sessions')
  .option('-a, --all', 'Show sessions from all projects')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const { list } = await import('./commands/list.js');
    list(opts);
  });

program
  .command('logs <session>')
  .description('Tail logs for a session')
  .option('-n, --lines <count>', 'Number of lines to show', '50')
  .option('--no-follow', 'Don\'t follow (just print and exit)')
  .action(async (session, opts) => {
    const { logs } = await import('./commands/logs.js');
    await logs(session, opts);
  });

program
  .command('dashboard')
  .alias('dash')
  .description('Start the web dashboard')
  .option('-p, --port <port>', 'Dashboard port', '4000')
  .action(async (opts) => {
    const { dashboard } = await import('./commands/dashboard.js');
    dashboard(opts);
  });

program
  .command('restart <session>')
  .description('Stop and restart a session (preserves branch, dir, env)')
  .option('-p, --port <port>', 'Change the port on restart')
  .option('-c, --command <cmd>', 'Change the command on restart')
  .action(async (session, opts) => {
    const { restart } = await import('./commands/restart.js');
    await restart(session, opts);
  });

program
  .command('attach <session>')
  .description('Attach to a running session\'s live output')
  .action(async (session) => {
    const { attach } = await import('./commands/attach.js');
    await attach(session);
  });

program
  .command('cleanup')
  .description('Remove dead sessions and optionally clean worktrees/logs')
  .option('-w, --worktrees', 'Also remove worktrees for dead sessions')
  .option('-l, --logs', 'Also remove log files for dead sessions')
  .option('-f, --force', 'Stop all running sessions too')
  .action(async (opts) => {
    const { cleanup } = await import('./commands/cleanup.js');
    await cleanup(opts);
  });

program
  .command('init')
  .description('Create a .devmux.json config file in the project root')
  .action(async () => {
    const { init } = await import('./commands/init.js');
    init();
  });

program.parse();

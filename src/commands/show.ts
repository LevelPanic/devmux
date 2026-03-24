import { watch } from 'node:fs/promises';
import { open } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { getSessionsByProject, getSessions, isProcessAlive, type Session } from '../lib/registry.js';
import { findProjectRoot } from '../lib/config.js';
import { logFilePath } from '../lib/paths.js';
import { bold, green, red, cyan, dim, yellow, gray, symbols } from '../lib/colors.js';

interface ShowOptions {
  all?: boolean;
}

// Colors for session tabs
const tabColors = [cyan, green, yellow, red, bold];

interface TrackedSession {
  session: Session;
  position: number;
  color: (s: string) => string;
  alive: boolean;
  /** Buffered log lines for this session */
  lines: string[];
}

const MAX_BUFFER_LINES = 5000;

/** ANSI helpers */
const ansi = {
  clearScreen: '\x1b[2J\x1b[H',
  clearLine: '\x1b[2K',
  moveTo: (row: number, col: number) => `\x1b[${row};${col}H`,
  savePos: '\x1b[s',
  restorePos: '\x1b[u',
  hideCursor: '\x1b[?25l',
  showCursor: '\x1b[?25h',
  inverse: (s: string) => `\x1b[7m${s}\x1b[27m`,
};

export async function show(opts: ShowOptions): Promise<void> {
  const projectRoot = opts.all ? undefined : findProjectRoot();
  const ac = new AbortController();

  const tracked = new Map<string, TrackedSession>();
  const sessionOrder: string[] = []; // ordered list of session IDs
  let colorIndex = 0;
  let activeTab = 0; // 0 = "All", 1+ = individual sessions

  function getColor(): (s: string) => string {
    const color = tabColors[colorIndex % tabColors.length];
    colorIndex++;
    return color;
  }

  /** Get terminal dimensions */
  function getSize(): { rows: number; cols: number } {
    return {
      rows: process.stdout.rows || 40,
      cols: process.stdout.columns || 120,
    };
  }

  /** Build the tab bar string */
  function renderTabBar(): string {
    const { cols } = getSize();
    const tabs: string[] = [];

    // "All" tab
    if (activeTab === 0) {
      tabs.push(ansi.inverse(bold(' All ')));
    } else {
      tabs.push(dim(' All '));
    }

    // Session tabs
    for (let i = 0; i < sessionOrder.length; i++) {
      const id = sessionOrder[i];
      const ts = tracked.get(id)!;
      const status = ts.alive ? green(symbols.bullet) : red(symbols.bullet);
      const port = dim(`:${ts.session.port}`);
      const label = ` ${ts.color(id)}${port} ${status} `;

      if (activeTab === i + 1) {
        tabs.push(ansi.inverse(label));
      } else {
        tabs.push(label);
      }
    }

    const bar = tabs.join(dim(' │ '));
    const hint = dim(' ← → switch │ c copy │ Ctrl+C exit');
    return `${bar}${hint}`;
  }

  /** Get the lines to display based on active tab */
  function getVisibleLines(): string[] {
    if (activeTab === 0) {
      // All sessions interleaved — collect from all and sort isn't practical,
      // so we just show all lines tagged with prefixes
      const all: string[] = [];
      for (const id of sessionOrder) {
        const ts = tracked.get(id)!;
        for (const line of ts.lines) {
          all.push(line);
        }
      }
      return all;
    }

    // Single session
    const id = sessionOrder[activeTab - 1];
    if (!id) return [];
    const ts = tracked.get(id);
    if (!ts) return [];
    return ts.lines;
  }

  /** Full redraw */
  function render(): void {
    const { rows, cols } = getSize();
    const tabBar = renderTabBar();

    // Reserve: 1 tab bar, 1 separator, 1 status bar at bottom
    const hasStatus = statusMessage.length > 0;
    const logRows = rows - 2 - (hasStatus ? 1 : 0);
    const visible = getVisibleLines();
    const displayLines = visible.slice(-logRows);

    process.stdout.write(ansi.hideCursor);
    process.stdout.write(ansi.clearScreen);

    // Tab bar at top
    process.stdout.write(tabBar + '\n');
    process.stdout.write(dim('─'.repeat(Math.min(cols, 120))) + '\n');

    // Log lines
    for (const line of displayLines) {
      process.stdout.write(line + '\n');
    }

    // Status bar at bottom
    if (hasStatus) {
      process.stdout.write(ansi.moveTo(rows, 1) + ansi.clearLine + statusMessage);
    }
  }

  /** Append a line for a session and re-render if visible */
  function appendLine(sessionId: string, rawLine: string): void {
    const ts = tracked.get(sessionId);
    if (!ts) return;

    const maxLen = Math.max(...sessionOrder.map((id) => id.length), 3);
    const padded = sessionId.padEnd(maxLen);
    const prefix = ts.color(`[${padded}]`);
    const tagged = `${prefix} ${rawLine}`;

    // Store both tagged (for "All" view) and raw
    ts.lines.push(tagged);
    if (ts.lines.length > MAX_BUFFER_LINES) {
      ts.lines.splice(0, ts.lines.length - MAX_BUFFER_LINES);
    }

    // Only re-render if this session is visible
    const isVisible = activeTab === 0 || sessionOrder[activeTab - 1] === sessionId;
    if (isVisible) {
      render();
    }
  }

  /** Append a system message for a session */
  function appendSystemLine(sessionId: string, msg: string): void {
    const ts = tracked.get(sessionId);
    if (!ts) return;

    const maxLen = Math.max(...sessionOrder.map((id) => id.length), 3);
    const padded = sessionId.padEnd(maxLen);
    const prefix = ts.color(`[${padded}]`);
    ts.lines.push(`${prefix} ${dim(msg)}`);
    render();
  }

  /** Start tailing a session's log file */
  async function tailSession(ts: TrackedSession): Promise<void> {
    const logFile = logFilePath(ts.session.id);

    // Wait for log file
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
    for (const line of lines.slice(-20)) {
      appendLine(ts.session.id, line);
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
            const newLines = buf.toString('utf-8').split('\n');
            for (const line of newLines) {
              if (line.length === 0) continue;
              appendLine(ts.session.id, line);
            }
            ts.position = stat.size;
          } else if (stat.size < ts.position) {
            ts.position = 0;
          }
        } finally {
          await fh.close();
        }
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        appendSystemLine(ts.session.id, '(log watcher ended)');
      }
    }
  }

  /** Scan registry for new/removed sessions — only renders if something changed */
  function refreshSessions(): void {
    const sessions = projectRoot
      ? getSessionsByProject(projectRoot)
      : getSessions();

    let changed = false;

    for (const session of sessions) {
      if (!tracked.has(session.id)) {
        const color = getColor();
        const ts: TrackedSession = {
          session,
          position: 0,
          color,
          alive: isProcessAlive(session.pid),
          lines: [],
        };

        tracked.set(session.id, ts);
        sessionOrder.push(session.id);
        changed = true;

        appendSystemLine(session.id, `${green(symbols.tick)} started (port ${cyan(String(session.port))})`);
        tailSession(ts).catch(() => {});
      }
    }

    // Check for dead sessions
    const activeIds = new Set(sessions.map((s) => s.id));
    for (const [id, ts] of tracked) {
      const wasAlive = ts.alive;
      ts.alive = activeIds.has(id) && isProcessAlive(ts.session.pid);
      if (wasAlive && !ts.alive) {
        changed = true;
        appendSystemLine(id, `${red(symbols.cross)} exited`);
      }
    }

    if (changed) render();
  }

  let statusMessage = '';
  let statusTimeout: ReturnType<typeof setTimeout> | null = null;

  function showStatus(msg: string, durationMs: number = 3000): void {
    statusMessage = msg;
    if (statusTimeout) clearTimeout(statusTimeout);
    statusTimeout = setTimeout(() => {
      statusMessage = '';
      render();
    }, durationMs);
    render();
  }

  /** Copy visible logs to clipboard using OSC 52 (works in most modern terminals) */
  function copyToClipboard(): void {
    const lines = getVisibleLines();
    // Strip ANSI codes for clean clipboard content
    const clean = lines
      .map((l) => l.replace(/\x1b\[[0-9;]*m/g, ''))
      .join('\n');

    // OSC 52 — terminal clipboard escape sequence (works in iTerm2, kitty, tmux, etc.)
    const b64 = Buffer.from(clean).toString('base64');
    process.stdout.write(`\x1b]52;c;${b64}\x07`);

    // Also try pbcopy (macOS) / xclip (Linux) as fallback
    try {
      execSync('pbcopy', { input: clean, stdio: ['pipe', 'ignore', 'ignore'] });
    } catch {
      try {
        execSync('xclip -selection clipboard', { input: clean, stdio: ['pipe', 'ignore', 'ignore'] });
      } catch {
        // Neither available — OSC 52 is the primary method
      }
    }

    const label = activeTab === 0 ? 'all' : sessionOrder[activeTab - 1];
    showStatus(`${green(symbols.tick)} Copied ${lines.length} lines from [${label}]`);
  }

  /** Handle keypress */
  function onKey(key: Buffer): void {
    const seq = key.toString();
    const totalTabs = sessionOrder.length + 1;

    // Ctrl+C
    if (seq === '\x03') {
      cleanup();
      return;
    }

    // Right arrow or Tab
    if (seq === '\x1b[C' || seq === '\t') {
      activeTab = (activeTab + 1) % totalTabs;
      render();
      return;
    }

    // Left arrow or Shift+Tab
    if (seq === '\x1b[D' || seq === '\x1b[Z') {
      activeTab = (activeTab - 1 + totalTabs) % totalTabs;
      render();
      return;
    }

    // c = copy visible logs
    if (seq === 'c' || seq === 'C') {
      copyToClipboard();
      return;
    }
  }

  function cleanup(): void {
    clearInterval(registryPoll);
    ac.abort();
    process.stdout.write(ansi.showCursor);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    console.log(`\n${dim('Detached from all sessions (still running)')}`);
    process.exit(0);
  }

  // Setup raw mode for keypresses
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onKey);
  }

  // Initial scan + render once
  refreshSessions();
  render();

  // Poll registry
  const registryPoll = setInterval(refreshSessions, 3000);

  // Re-render on terminal resize
  process.stdout.on('resize', render);

  // Handle signals
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Keep alive
  await new Promise(() => {});
}

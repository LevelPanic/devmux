import { watch } from 'node:fs/promises';
import { open } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { getSessionsByProject, getSessions, isProcessAlive, type Session } from '../lib/registry.js';
import { findProjectRoot } from '../lib/config.js';
import { logFilePath } from '../lib/paths.js';
import { bold, green, red, cyan, dim, yellow, symbols } from '../lib/colors.js';

interface ShowOptions {
  all?: boolean;
}

const tabColors = [cyan, green, yellow, red, bold];

interface TrackedSession {
  session: Session;
  position: number;
  color: (s: string) => string;
  alive: boolean;
  lines: string[]; // raw log lines (no prefix)
}

const MAX_LINES = 5000;
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07/g;

/** Get visible length of a string (strips ANSI escape codes) */
function visLen(s: string): number {
  return s.replace(ANSI_RE, '').length;
}

/** Pad a string to a visible width, accounting for ANSI codes */
function visPad(s: string, width: number): string {
  const pad = width - visLen(s);
  return pad > 0 ? s + ' '.repeat(pad) : s;
}

/** Truncate a string to a visible width, accounting for ANSI codes */
function visTrunc(s: string, maxWidth: number): string {
  const stripped = s.replace(ANSI_RE, '');
  if (stripped.length <= maxWidth) return s;
  // Walk through the string, tracking visible chars
  let vis = 0;
  let i = 0;
  while (i < s.length && vis < maxWidth) {
    if (s[i] === '\x1b') {
      // Skip entire escape sequence
      const match = s.slice(i).match(/^\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07/);
      if (match) {
        i += match[0].length;
        continue;
      }
    }
    vis++;
    i++;
  }
  return s.slice(0, i) + '\x1b[0m'; // reset styles at truncation point
}

/** Strip all ANSI escape codes */
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

const esc = {
  clear: '\x1b[2J\x1b[H',
  hideCursor: '\x1b[?25l',
  showCursor: '\x1b[?25h',
  moveTo: (r: number, c: number) => `\x1b[${r};${c}H`,
  clearLine: '\x1b[2K',
  inverse: (s: string) => `\x1b[7m${s}\x1b[27m`,
  // Clear from cursor to end of line
  clearToEOL: '\x1b[K',
  enterAltScreen: '\x1b[?1049h',
  leaveAltScreen: '\x1b[?1049l',
};

export async function show(opts: ShowOptions): Promise<void> {
  const projectRoot = opts.all ? undefined : findProjectRoot();
  const ac = new AbortController();

  const tracked = new Map<string, TrackedSession>();
  const sessionOrder: string[] = [];
  let colorIndex = 0;
  let selectedIndex = 0;
  let scrollOffset = 0;
  let statusMessage = '';
  let statusTimeout: ReturnType<typeof setTimeout> | null = null;

  function getColor(): (s: string) => string {
    const c = tabColors[colorIndex % tabColors.length];
    colorIndex++;
    return c;
  }

  function cols(): number { return process.stdout.columns || 120; }
  function rows(): number { return process.stdout.rows || 40; }

  // Layout constants
  const SIDEBAR_WIDTH = () => {
    const maxName = Math.max(12, ...sessionOrder.map((id) => id.length));
    return Math.min(maxName + 6, 30); // pad + status dot + border
  };
  const HEADER_ROWS = 1; // "Tasks" / "Logs" header
  const FOOTER_ROWS = 2; // keybinds

  /** Get the selected session */
  function selectedSession(): TrackedSession | undefined {
    const id = sessionOrder[selectedIndex];
    return id ? tracked.get(id) : undefined;
  }

  /** Draw the full screen */
  function render(): void {
    const c = cols();
    const r = rows();
    const sw = SIDEBAR_WIDTH();
    const logWidth = c - sw - 1; // -1 for border
    const contentRows = r - HEADER_ROWS - FOOTER_ROWS;

    process.stdout.write(esc.hideCursor);
    process.stdout.write(esc.clear);

    // === Header row ===
    const taskHeader = bold(' Tasks');
    const selected = selectedSession();
    const logHeader = selected
      ? ` ${selected.color(selected.session.id)} ${dim(`:${selected.session.port}`)}`
      : dim(' No session selected');
    process.stdout.write(esc.moveTo(1, 1));
    process.stdout.write(visPad(taskHeader, sw) + dim('│') + logHeader + esc.clearToEOL);

    // === Sidebar + Log pane ===
    for (let row = 0; row < contentRows; row++) {
      const screenRow = row + HEADER_ROWS + 1;
      process.stdout.write(esc.moveTo(screenRow, 1));

      // Sidebar
      if (row < sessionOrder.length) {
        const id = sessionOrder[row];
        const ts = tracked.get(id)!;
        const isSelected = row === selectedIndex;
        const status = ts.alive ? green(symbols.bullet) : red(symbols.bullet);
        const marker = isSelected ? bold('»') : ' ';
        const name = ts.color(id);
        let cell = ` ${status} ${marker} ${name}`;

        if (isSelected) {
          cell = esc.inverse(visPad(cell, sw));
        } else {
          cell = visPad(cell, sw);
        }
        process.stdout.write(cell);
      } else {
        process.stdout.write(' '.repeat(sw));
      }

      // Border
      process.stdout.write(dim('│'));

      // Log line
      if (selected) {
        const totalLines = selected.lines.length;
        const visibleStart = Math.max(0, totalLines - contentRows - scrollOffset);
        const lineIdx = visibleStart + row;
        if (lineIdx >= 0 && lineIdx < totalLines) {
          const line = selected.lines[lineIdx];
          process.stdout.write(' ' + visTrunc(line, logWidth - 1));
        }
      }

      process.stdout.write(esc.clearToEOL);
    }

    // === Footer ===
    const footerRow = r - FOOTER_ROWS + 1;
    process.stdout.write(esc.moveTo(footerRow, 1));
    process.stdout.write(dim('─'.repeat(c)));

    process.stdout.write(esc.moveTo(footerRow + 1, 1));
    const keybinds = `  ${bold('↑↓')} Select   ${bold('c')} Copy logs   ${bold('Ctrl+C')} Exit`;
    const scrollInfo = selected && selected.lines.length > contentRows
      ? dim(`  ${selected.lines.length} lines`)
      : '';

    if (statusMessage) {
      process.stdout.write(statusMessage + esc.clearToEOL);
    } else {
      process.stdout.write(keybinds + scrollInfo + esc.clearToEOL);
    }
  }

  /** Only redraw the log pane (right side) — faster than full render */
  function renderLogPane(): void {
    const c = cols();
    const r = rows();
    const sw = SIDEBAR_WIDTH();
    const logWidth = c - sw - 1;
    const contentRows = r - HEADER_ROWS - FOOTER_ROWS;
    const selected = selectedSession();

    // Update header with selected session name
    process.stdout.write(esc.moveTo(1, sw + 2));
    if (selected) {
      process.stdout.write(` ${selected.color(selected.session.id)} ${dim(`:${selected.session.port}`)}` + esc.clearToEOL);
    } else {
      process.stdout.write(dim(' No session selected') + esc.clearToEOL);
    }

    for (let row = 0; row < contentRows; row++) {
      const screenRow = row + HEADER_ROWS + 1;
      // Move past sidebar + border
      process.stdout.write(esc.moveTo(screenRow, sw + 2));

      if (selected) {
        const totalLines = selected.lines.length;
        const visibleStart = Math.max(0, totalLines - contentRows - scrollOffset);
        const lineIdx = visibleStart + row;
        if (lineIdx >= 0 && lineIdx < totalLines) {
          process.stdout.write(' ' + visTrunc(selected.lines[lineIdx], logWidth - 1));
        }
      }

      process.stdout.write(esc.clearToEOL);
    }
  }

  /** Update just the sidebar selection highlight */
  function renderSidebar(): void {
    const r = rows();
    const sw = SIDEBAR_WIDTH();
    const contentRows = r - HEADER_ROWS - FOOTER_ROWS;

    for (let row = 0; row < Math.min(contentRows, sessionOrder.length); row++) {
      const screenRow = row + HEADER_ROWS + 1;
      const id = sessionOrder[row];
      const ts = tracked.get(id)!;
      const isSelected = row === selectedIndex;
      const status = ts.alive ? green(symbols.bullet) : red(symbols.bullet);
      const marker = isSelected ? bold('»') : ' ';
      const name = ts.color(id);
      let cell = ` ${status} ${marker} ${name}`;

      process.stdout.write(esc.moveTo(screenRow, 1));
      if (isSelected) {
        process.stdout.write(esc.inverse(visPad(cell, sw)));
      } else {
        process.stdout.write(visPad(cell, sw));
      }
    }
  }

  function showStatus(msg: string, durationMs: number = 3000): void {
    statusMessage = msg;
    if (statusTimeout) clearTimeout(statusTimeout);
    statusTimeout = setTimeout(() => {
      statusMessage = '';
      // Redraw footer
      const r = rows();
      process.stdout.write(esc.moveTo(r, 1));
      process.stdout.write(`  ${bold('↑↓')} Select   ${bold('c')} Copy logs   ${bold('Ctrl+C')} Exit` + esc.clearToEOL);
    }, durationMs);
    // Show status in footer
    const r = rows();
    process.stdout.write(esc.moveTo(r, 1));
    process.stdout.write(msg + esc.clearToEOL);
  }

  /** Append a log line for a session */
  function appendLine(sessionId: string, rawLine: string): void {
    const ts = tracked.get(sessionId);
    if (!ts) return;

    ts.lines.push(rawLine);
    if (ts.lines.length > MAX_LINES) {
      ts.lines.splice(0, ts.lines.length - MAX_LINES);
    }

    // Only update log pane if this is the selected session and we're at the bottom
    if (sessionOrder[selectedIndex] === sessionId && scrollOffset === 0) {
      renderLogPane();
    }
  }

  function appendSystemLine(sessionId: string, msg: string): void {
    appendLine(sessionId, dim(msg));
  }

  /** Tail a session's log file */
  async function tailSession(ts: TrackedSession): Promise<void> {
    const logFile = logFilePath(ts.session.id);

    let waitCount = 0;
    while (!existsSync(logFile) && waitCount < 60) {
      await new Promise((r) => setTimeout(r, 500));
      if (ac.signal.aborted) return;
      waitCount++;
    }
    if (!existsSync(logFile)) return;

    const content = readFileSync(logFile, 'utf-8');
    const lines = content.split('\n').filter((l) => l.length > 0);
    for (const line of lines.slice(-50)) {
      appendLine(ts.session.id, line);
    }
    ts.position = Buffer.byteLength(content, 'utf-8');

    try {
      const watcher = watch(logFile, { signal: ac.signal });
      for await (const _ of watcher) {
        const fh = await open(logFile, 'r');
        try {
          const stat = await fh.stat();
          if (stat.size > ts.position) {
            const buf = Buffer.alloc(stat.size - ts.position);
            await fh.read(buf, 0, buf.length, ts.position);
            for (const line of buf.toString('utf-8').split('\n')) {
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

  /** Scan registry — only re-render if something changed */
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

  function copyToClipboard(): void {
    const selected = selectedSession();
    if (!selected) return;

    const clean = selected.lines
      .map((l) => stripAnsi(l))
      .join('\n');

    // OSC 52
    const b64 = Buffer.from(clean).toString('base64');
    process.stdout.write(`\x1b]52;c;${b64}\x07`);

    // pbcopy / xclip fallback
    try {
      execSync('pbcopy', { input: clean, stdio: ['pipe', 'ignore', 'ignore'] });
    } catch {
      try {
        execSync('xclip -selection clipboard', { input: clean, stdio: ['pipe', 'ignore', 'ignore'] });
      } catch {
        // OSC 52 only
      }
    }

    showStatus(`  ${green(symbols.tick)} Copied ${selected.lines.length} lines from ${bold(selected.session.id)}`);
  }

  function onKey(key: Buffer): void {
    const seq = key.toString();

    // Ctrl+C
    if (seq === '\x03') { cleanup(); return; }

    // Up arrow
    if (seq === '\x1b[A') {
      if (sessionOrder.length > 0) {
        selectedIndex = (selectedIndex - 1 + sessionOrder.length) % sessionOrder.length;
        scrollOffset = 0;
        renderSidebar();
        renderLogPane();
      }
      return;
    }

    // Down arrow
    if (seq === '\x1b[B') {
      if (sessionOrder.length > 0) {
        selectedIndex = (selectedIndex + 1) % sessionOrder.length;
        scrollOffset = 0;
        renderSidebar();
        renderLogPane();
      }
      return;
    }

    // c = copy
    if (seq === 'c' || seq === 'C') {
      copyToClipboard();
      return;
    }
  }

  function cleanup(): void {
    clearInterval(registryPoll);
    ac.abort();
    process.stdout.write(esc.showCursor);
    process.stdout.write(esc.leaveAltScreen);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    console.log(dim('Detached from all sessions (still running)'));
    process.exit(0);
  }

  // Require a TTY for the interactive TUI
  if (!process.stdout.isTTY) {
    console.error('devmux show requires an interactive terminal');
    process.exit(1);
  }

  // Enter alternate screen buffer — no scrollback, fixed canvas
  process.stdout.write(esc.enterAltScreen);

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', onKey);

  refreshSessions();
  render();

  const registryPoll = setInterval(refreshSessions, 3000);

  // Debounced resize handler
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  process.stdout.on('resize', () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 80);
  });

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  await new Promise(() => {});
}

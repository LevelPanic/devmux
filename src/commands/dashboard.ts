import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { getSessions, isProcessAlive, pruneDeadSessions } from '../lib/registry.js';
import { logFilePath } from '../lib/paths.js';
import { readFileSync, existsSync } from 'node:fs';
import { bold, green, cyan, dim, symbols } from '../lib/colors.js';

interface DashboardOptions {
  port?: string;
}

function buildHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>devmux — sessions</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'SF Mono', 'Fira Code', monospace;
      background: #0a0a0a;
      color: #e0e0e0;
      padding: 2rem;
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 600;
      margin-bottom: 1.5rem;
      color: #fff;
    }
    h1 span { color: #22c55e; }
    .empty { color: #666; font-style: italic; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
      gap: 1rem;
    }
    .card {
      background: #161616;
      border: 1px solid #2a2a2a;
      border-radius: 8px;
      padding: 1.25rem;
      transition: border-color 0.2s;
    }
    .card:hover { border-color: #444; }
    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 0.75rem;
    }
    .session-name {
      font-size: 1.1rem;
      font-weight: 600;
      color: #fff;
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 0.8rem;
      padding: 2px 8px;
      border-radius: 999px;
    }
    .status.running { background: #052e16; color: #22c55e; }
    .status.dead { background: #2a0a0a; color: #ef4444; }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }
    .status.running .status-dot { background: #22c55e; }
    .status.dead .status-dot { background: #ef4444; }
    .meta { display: grid; grid-template-columns: 80px 1fr; gap: 4px; font-size: 0.85rem; }
    .meta dt { color: #666; }
    .meta dd { color: #aaa; }
    .meta dd a { color: #38bdf8; text-decoration: none; }
    .meta dd a:hover { text-decoration: underline; }
    .actions {
      margin-top: 1rem;
      display: flex;
      gap: 0.5rem;
    }
    .btn {
      font-size: 0.8rem;
      padding: 4px 12px;
      border-radius: 4px;
      border: 1px solid #333;
      background: #1a1a1a;
      color: #ccc;
      cursor: pointer;
      font-family: inherit;
    }
    .btn:hover { background: #252525; border-color: #555; }
    .btn.danger { border-color: #7f1d1d; color: #f87171; }
    .btn.danger:hover { background: #1c0a0a; }
    .refresh-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1rem;
      color: #666;
      font-size: 0.8rem;
    }
    .refresh-bar button {
      font-family: inherit;
      font-size: 0.8rem;
      padding: 4px 12px;
      border-radius: 4px;
      border: 1px solid #333;
      background: #1a1a1a;
      color: #ccc;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <h1><span>devmux</span> sessions</h1>
  <div class="refresh-bar">
    <span id="updated">—</span>
    <button onclick="loadSessions()">Refresh</button>
  </div>
  <div id="sessions" class="grid"></div>

  <script>
    async function loadSessions() {
      const res = await fetch('/api/sessions');
      const sessions = await res.json();
      const el = document.getElementById('sessions');
      document.getElementById('updated').textContent = 'Updated ' + new Date().toLocaleTimeString();

      if (sessions.length === 0) {
        el.innerHTML = '<p class="empty">No active sessions. Start one with: devmux up &lt;branch&gt;</p>';
        return;
      }

      el.innerHTML = sessions.map(s => \`
        <div class="card">
          <div class="card-header">
            <span class="session-name">\${s.id}</span>
            <span class="status \${s.alive ? 'running' : 'dead'}">
              <span class="status-dot"></span>
              \${s.alive ? 'running' : 'dead'}
            </span>
          </div>
          <dl class="meta">
            <dt>Port</dt>
            <dd><a href="http://localhost:\${s.port}" target="_blank">:\${s.port}</a></dd>
            <dt>Branch</dt>
            <dd>\${s.branch}</dd>
            <dt>PID</dt>
            <dd>\${s.pid}</dd>
            <dt>Dir</dt>
            <dd title="\${s.worktreeDir}">\${s.worktreeDir.split('/').slice(-2).join('/')}</dd>
            <dt>Started</dt>
            <dd>\${new Date(s.startedAt).toLocaleString()}</dd>
          </dl>
          <div class="actions">
            <button class="btn" onclick="window.open('http://localhost:\${s.port}', '_blank')">Open</button>
            <button class="btn danger" onclick="stopSession('\${s.id}')">Stop</button>
          </div>
        </div>
      \`).join('');
    }

    async function stopSession(id) {
      if (!confirm('Stop session ' + id + '?')) return;
      await fetch('/api/sessions/' + id, { method: 'DELETE' });
      loadSessions();
    }

    loadSessions();
    setInterval(loadSessions, 5000);
  </script>
</body>
</html>`;
}

function handleAPI(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.url === '/api/sessions' && req.method === 'GET') {
    pruneDeadSessions();
    const sessions = getSessions().map((s) => ({
      ...s,
      alive: isProcessAlive(s.pid),
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(sessions));
    return true;
  }

  const stopMatch = req.url?.match(/^\/api\/sessions\/(.+)$/);
  if (stopMatch && req.method === 'DELETE') {
    const id = decodeURIComponent(stopMatch[1]);
    // Dynamic import to avoid circular
    import('../lib/process-manager.js').then(({ killSession }) => {
      killSession(id).then((session) => {
        if (session) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ stopped: true, id }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Session not found' }));
        }
      });
    });
    return true;
  }

  if (req.url === '/api/logs' && req.method === 'GET') {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const sessionId = url.searchParams.get('session');
    if (!sessionId) {
      res.writeHead(400);
      res.end('Missing session param');
      return true;
    }
    const logFile = logFilePath(sessionId);
    if (existsSync(logFile)) {
      const content = readFileSync(logFile, 'utf-8');
      const lines = content.split('\n').slice(-100).join('\n');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(lines);
    } else {
      res.writeHead(404);
      res.end('No logs');
    }
    return true;
  }

  return false;
}

export function dashboard(opts: DashboardOptions): void {
  const port = parseInt(opts.port || '4000', 10);

  const server = createServer((req, res) => {
    if (handleAPI(req, res)) return;

    // Serve dashboard HTML
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(buildHTML());
  });

  server.listen(port, () => {
    console.log(`${green(symbols.tick)} Dashboard running at ${cyan(`http://localhost:${port}`)}`);
    console.log(`${dim('Press Ctrl+C to stop')}`);
  });

  process.on('SIGINT', () => {
    server.close();
    process.exit(0);
  });
}

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleAPI } from './api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 3333;
const panelPath = join(__dirname, 'panel.html');

export function startPanel(opts = {}) {
  const port = opts.port || PORT;
  let panelHTML;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const pathname = url.pathname;

    // Serve panel HTML
    if (pathname === '/' && req.method === 'GET') {
      // Re-read in dev, cache in prod
      if (!panelHTML) panelHTML = readFileSync(panelPath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(panelHTML);
      return;
    }

    // API routes
    if (pathname.startsWith('/api/')) {
      return handleAPI(req, res, pathname);
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  let retryCount = 0;
  const MAX_RETRIES = 2;

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      if (retryCount >= MAX_RETRIES) {
        console.error(`Could not free port ${port} after ${MAX_RETRIES} attempts. Try: lsof -ti:${port} | xargs kill -9`);
        process.exit(1);
      }
      retryCount++;
      const log = opts.onLog || console.log.bind(console);
      log(`Port ${port} in use, killing old process...`);
      import('node:child_process').then(({ execSync }) => {
        try {
          // Kill processes on this port, but not ourselves
          const myPid = process.pid;
          const pids = execSync(`lsof -ti:${port}`, { encoding: 'utf-8' }).trim().split('\n')
            .map(p => p.trim()).filter(p => p && p !== String(myPid));
          if (pids.length > 0) {
            execSync(`kill ${pids.join(' ')}`, { stdio: 'ignore' });
          }
          setTimeout(() => server.listen(port, '127.0.0.1'), 1000);
        } catch {
          // lsof found nothing or kill failed — just retry after delay
          setTimeout(() => server.listen(port, '127.0.0.1'), 1000);
        }
      });
      return;
    }
    throw err;
  });

  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}`;
    console.log(`BetterBot panel running at ${url}`);

    // Open browser
    if (!opts.noBrowser) {
      import('node:child_process').then(({ exec }) => {
        exec(`open "${url}"`);
      });
    }
  });

  return server;
}

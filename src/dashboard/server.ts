import http from 'http';

import { WebSocketServer } from 'ws';

import { DASHBOARD_PORT } from '../config.js';
import { logger } from '../logger.js';
import { handleApiRequest } from './api.js';
import { initLogStream, stopLogStream } from './log-stream.js';
import { getDashboardHtml } from './ui.js';

let server: http.Server | null = null;

export function startDashboard(): void {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${DASHBOARD_PORT}`);

    // CORS for local dev convenience
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      handleApiRequest(req, res, url).catch((err) => {
        logger.error({ err }, 'Dashboard API error');
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
      });
      return;
    }

    // Serve dashboard UI for all other paths
    const html = getDashboardHtml();
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(html),
    });
    res.end(html);
  });

  const wss = new WebSocketServer({ server, path: '/ws/logs' });
  initLogStream(wss);

  server.listen(DASHBOARD_PORT, '0.0.0.0', () => {
    logger.info(`Dashboard running at http://localhost:${DASHBOARD_PORT}`);
  });
}

export function stopDashboard(): void {
  stopLogStream();
  server?.close();
  server = null;
}

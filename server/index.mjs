import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.mjs';

export function createHoloServer(options = {}) {
  const app = createApp(options);
  return http.createServer((req, res) => {
    app(req, res).catch((error) => {
      console.error('[server] unhandled request error', error);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      }
      res.end('Internal server error');
    });
  });
}

export function startServer({ port = Number(process.env.PORT) || 8787, host = process.env.HOST || '0.0.0.0', ...options } = {}) {
  const server = createHoloServer(options);
  server.listen(port, host, () => {
    const address = server.address();
    const shown = typeof address === 'object' && address ? address.port : port;
    console.log(`[server] Holo backend listening on http://localhost:${shown}`);
    console.log('[server] API: /api/health, /api/models');
  });
  return server;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const server = startServer();
  const stop = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

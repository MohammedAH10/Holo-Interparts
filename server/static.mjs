import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
  '.stl': 'model/stl',
};

export function createStaticHandler(distDir) {
  const root = path.resolve(distDir);

  return async function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    if (pathname.startsWith('/api/')) return false;

    let requested;
    try {
      requested = decodeURIComponent(pathname);
    } catch {
      return false;
    }

    const relative = requested === '/' ? 'index.html' : requested.replace(/^\/+/, '');
    let file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep) && file !== root) return false;

    let stat = await statFile(file);
    if (!stat && !path.extname(file)) {
      file = path.join(root, 'index.html');
      stat = await statFile(file);
    }
    if (!stat || !stat.isFile()) return false;

    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const immutable = /\/assets\//.test(file);
    res.writeHead(200, {
      'content-type': type,
      'content-length': stat.size,
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    await new Promise((resolve, reject) => {
      const stream = fs.createReadStream(file);
      stream.on('error', reject);
      stream.on('end', resolve);
      stream.pipe(res);
    });
    return true;
  };
}

async function statFile(file) {
  try {
    return await fsp.stat(file);
  } catch {
    return null;
  }
}

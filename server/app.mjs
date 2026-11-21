import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HttpError,
  applyCors,
  handleError,
  readBody,
  sendJson,
  sendText,
} from './http.mjs';
import { parseMultipart, findFilePart } from './multipart.mjs';
import { processStl, DEFAULT_MAX_TRIANGLES } from './process.mjs';
import { ModelStore } from './store.mjs';
import { createStaticHandler } from './static.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIST = path.join(HERE, '..', 'dist');
const DEFAULT_MAX_UPLOAD = Number(process.env.HOLO_MAX_UPLOAD) || 60 * 1024 * 1024;

export function createApp(options = {}) {
  const store = options.store || new ModelStore(options.dataDir);
  const serveStatic = options.serveStatic === false
    ? null
    : createStaticHandler(options.distDir || DEFAULT_DIST);
  const maxUpload = options.maxUpload || DEFAULT_MAX_UPLOAD;
  const maxTriangles = options.maxTriangles || DEFAULT_MAX_TRIANGLES;

  return async function handleRequest(req, res) {
    applyCors(req, res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      handleError(res, new HttpError(400, 'Invalid request URL', 'bad_request'));
      return;
    }

    try {
      if (url.pathname === '/api/health' && req.method === 'GET') {
        sendJson(res, 200, {
          ok: true,
          service: 'holo-interparts-backend',
          maxUpload,
          maxTriangles,
        });
        return;
      }

      if (url.pathname === '/api/models' && req.method === 'GET') {
        const models = await store.listModels();
        sendJson(res, 200, { models });
        return;
      }

      if (url.pathname === '/api/models' && req.method === 'POST') {
        const record = await handleUpload(req, { store, maxUpload, maxTriangles });
        sendJson(res, 201, { model: record });
        return;
      }

      const route = /^\/api\/models\/([^/]+)(?:\/(model\.glb|source\.stl))?$/.exec(url.pathname);
      if (route) {
        const id = route[1];
        const file = route[2];

        if (req.method === 'GET' && !file) {
          const model = await store.getModel(id);
          if (!model) throw new HttpError(404, 'Model not found', 'not_found');
          sendJson(res, 200, { model });
          return;
        }

        if (req.method === 'DELETE' && !file) {
          const removed = await store.removeModel(id);
          if (!removed) throw new HttpError(404, 'Model not found', 'not_found');
          sendJson(res, 200, { ok: true, id });
          return;
        }

        if (req.method === 'GET' && file === 'model.glb') {
          const model = await store.getModel(id);
          if (!model) throw new HttpError(404, 'Model not found', 'not_found');
          const buffer = await store.readGlb(id);
          if (!buffer) throw new HttpError(404, 'Processed model is missing', 'not_found');
          sendBinary(res, buffer, 'model/gltf-binary', filenameFor(model.name, 'glb'));
          return;
        }

        if (req.method === 'GET' && file === 'source.stl') {
          const model = await store.getModel(id);
          if (!model) throw new HttpError(404, 'Model not found', 'not_found');
          const buffer = await store.readSource(id);
          if (!buffer) throw new HttpError(404, 'Source file is missing', 'not_found');
          sendBinary(res, buffer, 'model/stl', filenameFor(model.name, 'stl'));
          return;
        }
      }

      if (url.pathname.startsWith('/api/')) {
        throw new HttpError(404, 'Unknown API route', 'not_found');
      }

      if (serveStatic && await serveStatic(req, res, url.pathname)) return;
      sendText(res, 404, 'Not found');
    } catch (error) {
      handleError(res, error);
    }
  };
}

async function handleUpload(req, { store, maxUpload, maxTriangles }) {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    throw new HttpError(415, 'Upload must be multipart/form-data', 'unsupported_media_type');
  }

  const body = await readBody(req, maxUpload);
  const parts = parseMultipart(body, contentType);
  const file = findFilePart(parts, 'file');
  if (!file || !file.data?.length) {
    throw new HttpError(400, 'Attach an STL file in the "file" field', 'missing_file');
  }
  if (!/\.stl$/i.test(file.filename || '')) {
    throw new HttpError(415, 'Only .stl files can be uploaded to this endpoint', 'unsupported_format');
  }

  const originalName = path.basename(file.filename || 'model.stl');
  const name = prettyName(originalName.replace(/\.stl$/i, ''));
  const processed = processStl(file.data, { name, maxTriangles });

  return store.saveModel({
    originalName,
    sourceBuffer: file.data,
    glbBuffer: processed.glb,
    metadata: {
      ...processed.meta,
      name,
    },
  });
}

function sendBinary(res, buffer, type, filename) {
  res.writeHead(200, {
    'content-type': type,
    'content-length': buffer.length,
    'cache-control': 'public, max-age=31536000, immutable',
    'content-disposition': `inline; filename="${filename}"`,
  });
  res.end(buffer);
}

function filenameFor(name, extension) {
  const clean = String(name || 'model').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'model';
  return `${clean}.${extension}`;
}

function prettyName(value) {
  return String(value || 'Imported model')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

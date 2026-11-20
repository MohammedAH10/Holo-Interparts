export class HttpError extends Error {
  constructor(status, message, code = 'http_error') {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

export async function readBody(req, limit = 60 * 1024 * 1024) {
  const declared = Number(req.headers['content-length'] || 0);
  if (declared > limit) {
    throw new HttpError(413, `Upload is larger than ${formatBytes(limit)}`, 'payload_too_large');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      throw new HttpError(413, `Upload is larger than ${formatBytes(limit)}`, 'payload_too_large');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

export function sendJson(res, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
  });
  res.end(body);
}

export function sendText(res, status, value, type = 'text/plain; charset=utf-8') {
  const body = Buffer.from(String(value));
  res.writeHead(status, {
    'content-type': type,
    'content-length': String(body.length),
    'cache-control': 'no-store',
  });
  res.end(body);
}

export function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'origin');
  } else {
    res.setHeader('access-control-allow-origin', '*');
  }
  res.setHeader('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type,accept');
  res.setHeader('access-control-max-age', '86400');
}

export function handleError(res, error) {
  if (res.headersSent) {
    res.end();
    return;
  }
  const status = error instanceof HttpError ? error.status : 500;
  const payload = {
    error: error instanceof HttpError ? error.code : 'internal_error',
    message: status === 500 ? 'Unexpected server error' : error.message,
  };
  if (status === 500) console.error(error);
  sendJson(res, status, payload);
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const n = bytes / 1024 ** i;
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

export function safeId(value) {
  const id = String(value || '');
  return /^[a-zA-Z0-9_-]{4,80}$/.test(id) ? id : null;
}

import { HttpError } from './http.mjs';

export function parseMultipart(body, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!match) throw new HttpError(400, 'Missing multipart boundary', 'invalid_multipart');

  const boundary = (match[1] || match[2]).trim();
  const delimiter = Buffer.from(`--${boundary}`);
  const parts = [];
  let cursor = body.indexOf(delimiter);

  while (cursor !== -1) {
    cursor += delimiter.length;
    if (body[cursor] === 45 && body[cursor + 1] === 45) break;
    if (body[cursor] === 13 && body[cursor + 1] === 10) cursor += 2;

    const headerEnd = body.indexOf('\r\n\r\n', cursor);
    if (headerEnd === -1) break;

    const rawHeaders = body.subarray(cursor, headerEnd).toString('utf8');
    const contentStart = headerEnd + 4;
    const next = body.indexOf(delimiter, contentStart);
    if (next === -1) break;

    let contentEnd = next;
    if (body[contentEnd - 2] === 13 && body[contentEnd - 1] === 10) contentEnd -= 2;

    const headers = parseHeaders(rawHeaders);
    const disposition = headers['content-disposition'] || '';
    const name = dispositionValue(disposition, 'name');
    const filename = dispositionValue(disposition, 'filename');

    parts.push({
      name,
      filename,
      contentType: headers['content-type'] || 'application/octet-stream',
      data: body.subarray(contentStart, contentEnd),
    });

    cursor = next;
  }

  if (parts.length === 0) throw new HttpError(400, 'No multipart fields found', 'invalid_multipart');
  return parts;
}

export function findFilePart(parts, field = 'file') {
  return parts.find((part) => part.filename && (!field || part.name === field))
    || parts.find((part) => part.filename)
    || null;
}

function parseHeaders(text) {
  const headers = {};
  for (const line of text.split('\r\n')) {
    const at = line.indexOf(':');
    if (at <= 0) continue;
    headers[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
  }
  return headers;
}

function dispositionValue(header, key) {
  const quoted = new RegExp(`${key}="([^"]*)"`, 'i').exec(header);
  if (quoted) return quoted[1];
  const plain = new RegExp(`${key}=([^;]+)`, 'i').exec(header);
  return plain ? plain[1].trim() : '';
}

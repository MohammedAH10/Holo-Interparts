import { HttpError } from './http.mjs';

export function parseStl(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 15) {
    throw new HttpError(422, 'The STL file is empty or truncated', 'invalid_stl');
  }

  const binary = tryBinary(buffer);
  if (binary) return binary;

  const ascii = tryAscii(buffer);
  if (ascii) return ascii;

  throw new HttpError(422, 'File is not a valid binary or ASCII STL mesh', 'invalid_stl');
}

function tryBinary(buffer) {
  if (buffer.length < 84) return null;
  const count = buffer.readUInt32LE(80);
  if (!Number.isSafeInteger(count) || count <= 0) return null;
  const expected = 84 + count * 50;
  if (expected > buffer.length) return null;

  const positions = new Float32Array(count * 9);
  const normals = new Float32Array(count * 9);
  let p = 84;

  for (let i = 0; i < count; i++, p += 50) {
    let nx = buffer.readFloatLE(p);
    let ny = buffer.readFloatLE(p + 4);
    let nz = buffer.readFloatLE(p + 8);
    if (!isFiniteVec(nx, ny, nz) || (nx === 0 && ny === 0 && nz === 0)) {
      const fallback = triangleNormal(buffer, p + 12, p + 24, p + 36);
      nx = fallback[0]; ny = fallback[1]; nz = fallback[2];
    }
    const o = i * 9;
    for (let v = 0; v < 3; v++) {
      const q = p + 12 + v * 12;
      const x = buffer.readFloatLE(q);
      const y = buffer.readFloatLE(q + 4);
      const z = buffer.readFloatLE(q + 8);
      if (!isFiniteVec(x, y, z)) {
        throw new HttpError(422, `STL contains a non-finite vertex at triangle ${i + 1}`, 'invalid_stl');
      }
      const k = o + v * 3;
      positions[k] = x;
      positions[k + 1] = y;
      positions[k + 2] = z;
      normals[k] = nx;
      normals[k + 1] = ny;
      normals[k + 2] = nz;
    }
  }

  return { format: 'binary', positions, normals, triangleCount: count };
}

function tryAscii(buffer) {
  const text = buffer.toString('utf8');
  if (text.includes('\u0000') || !/facet\s+normal/i.test(text) || !/vertex\s+/i.test(text)) {
    return null;
  }

  const positions = [];
  const normals = [];
  let normal = [0, 0, 0];
  let vertices = [];
  let triangles = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^facet\s+normal\b/i.test(line)) {
      normal = readNumbers(line, 3);
      if (!normal) normal = [0, 0, 0];
      vertices = [];
    } else if (/^vertex\b/i.test(line)) {
      const vertex = readNumbers(line, 3);
      if (!vertex) {
        throw new HttpError(422, 'STL contains an invalid vertex line', 'invalid_stl');
      }
      vertices.push(vertex);
      if (vertices.length === 3) {
        const n = isFiniteVec(...normal) && !(normal[0] === 0 && normal[1] === 0 && normal[2] === 0)
          ? normal
          : faceNormal(vertices);
        for (const vertex of vertices) {
          positions.push(vertex[0], vertex[1], vertex[2]);
          normals.push(n[0], n[1], n[2]);
        }
        triangles++;
        vertices = [];
      }
    } else if (/^endfacet\b/i.test(line)) {
      vertices = [];
    }
  }

  if (triangles === 0) return null;
  return {
    format: 'ascii',
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    triangleCount: triangles,
  };
}

function readNumbers(line, count) {
  const numbers = line.match(/-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g);
  if (!numbers || numbers.length < count) return null;
  const values = numbers.slice(-count).map(Number);
  return values.every(Number.isFinite) ? values : null;
}

function triangleNormal(buffer, a, b, c) {
  const av = [buffer.readFloatLE(a), buffer.readFloatLE(a + 4), buffer.readFloatLE(a + 8)];
  const bv = [buffer.readFloatLE(b), buffer.readFloatLE(b + 4), buffer.readFloatLE(b + 8)];
  const cv = [buffer.readFloatLE(c), buffer.readFloatLE(c + 4), buffer.readFloatLE(c + 8)];
  return faceNormal([av, bv, cv]);
}

function faceNormal(vertices) {
  const [a, b, c] = vertices;
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-12) return [0, 0, 1];
  nx /= len; ny /= len; nz /= len;
  return [nx, ny, nz];
}

function isFiniteVec(x, y, z) {
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);
}

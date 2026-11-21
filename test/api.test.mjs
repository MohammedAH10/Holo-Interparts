import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHoloServer } from '../server/index.mjs';

test('upload, list, download and delete an STL model', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'holo-api-'));
  const server = createHoloServer({ dataDir, serveStatic: false });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);

  const rejected = await fetch(`${base}/api/models`, {
    method: 'POST',
    body: form('notes.txt', Buffer.from('hello'), 'text/plain'),
  });
  assert.equal(rejected.status, 415);

  const upload = await fetch(`${base}/api/models`, {
    method: 'POST',
    body: form('sample part.stl', binaryStl(), 'application/octet-stream'),
  });
  assert.equal(upload.status, 201);
  const { model } = await upload.json();
  assert.equal(model.name, 'Sample Part');
  assert.equal(model.sourceFormat, 'binary');
  assert.equal(model.sourceTriangleCount, 1);
  assert.equal(model.triangleCount, 1);
  assert.deepEqual(model.originalCenter, [0.5, 0.5, 0]);
  assert.ok(model.id);

  const list = await fetch(`${base}/api/models`);
  const listed = (await list.json()).models;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, model.id);

  const detail = await fetch(`${base}/api/models/${model.id}`);
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).model.id, model.id);

  const glb = await fetch(`${base}/api/models/${model.id}/model.glb`);
  assert.equal(glb.status, 200);
  assert.equal(glb.headers.get('content-type'), 'model/gltf-binary');
  const glbBytes = Buffer.from(await glb.arrayBuffer());
  assert.equal(glbBytes.readUInt32LE(0), 0x46546c67);

  const source = await fetch(`${base}/api/models/${model.id}/source.stl`);
  assert.equal(source.status, 200);
  assert.equal(source.headers.get('content-type'), 'model/stl');

  const missing = await fetch(`${base}/api/models/does-not-exist`);
  assert.equal(missing.status, 404);

  const removed = await fetch(`${base}/api/models/${model.id}`, { method: 'DELETE' });
  assert.equal(removed.status, 200);

  const empty = await fetch(`${base}/api/models`);
  assert.equal((await empty.json()).models.length, 0);
});

function form(filename, bytes, type) {
  const data = new FormData();
  data.append('file', new Blob([bytes], { type }), filename);
  return data;
}

function binaryStl() {
  const buffer = Buffer.alloc(84 + 50);
  buffer.writeUInt32LE(1, 80);
  buffer.writeFloatLE(0, 84);
  buffer.writeFloatLE(0, 88);
  buffer.writeFloatLE(1, 92);
  const vertices = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  vertices.forEach((value, index) => buffer.writeFloatLE(value, 84 + 12 + index * 4));
  return buffer;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { processStl } from '../server/process.mjs';

test('processStl simplifies, centers and exports metadata', () => {
  const { glb, meta } = processStl(binaryStl(gridTriangles(40, 2)), {
    name: 'grid',
    maxTriangles: 500,
  });

  assert.equal(meta.sourceFormat, 'binary');
  assert.equal(meta.sourceTriangleCount, 40 * 40 * 2);
  assert.equal(meta.simplified, true);
  assert.ok(meta.triangleCount < meta.sourceTriangleCount);
  assert.ok(meta.triangleCount <= 1_000);
  assert.ok(meta.vertexCount > 0);
  assert.ok(meta.radius > 0);
  assert.equal(meta.bounds.min[0], -meta.bounds.max[0]);
  assert.equal(meta.bounds.min[1], -meta.bounds.max[1]);
  assert.equal(meta.bounds.min[2], -meta.bounds.max[2]);
  assert.equal(glb.readUInt32LE(0), 0x46546c67);
  assert.ok(glb.length > 100);
});

test('processStl reports invalid STL data as a 422 error', () => {
  assert.throws(() => processStl(Buffer.from('nope')), (error) => {
    assert.equal(error.status, 422);
    return true;
  });
});

function gridTriangles(size, step) {
  const triangles = [];
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      const x0 = x * step, y0 = y * step;
      const x1 = x0 + step, y1 = y0 + step;
      triangles.push([[x0, y0, 0], [x1, y0, 0], [x0, y1, 0]]);
      triangles.push([[x1, y0, 0], [x1, y1, 0], [x0, y1, 0]]);
    }
  }
  return triangles;
}

function binaryStl(triangles) {
  const buffer = Buffer.alloc(84 + triangles.length * 50);
  buffer.writeUInt32LE(triangles.length, 80);
  triangles.forEach((triangle, index) => {
    let offset = 84 + index * 50;
    buffer.writeFloatLE(0, offset);
    buffer.writeFloatLE(0, offset + 4);
    buffer.writeFloatLE(1, offset + 8);
    for (const vertex of triangle) {
      offset += 12;
      buffer.writeFloatLE(vertex[0], offset);
      buffer.writeFloatLE(vertex[1], offset + 4);
      buffer.writeFloatLE(vertex[2], offset + 8);
    }
  });
  return buffer;
}

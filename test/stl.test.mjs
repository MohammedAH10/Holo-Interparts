import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStl } from '../server/stl.mjs';

test('parses a binary STL triangle', () => {
  const buffer = binaryStl([
    [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
  ]);
  const mesh = parseStl(buffer);
  assert.equal(mesh.format, 'binary');
  assert.equal(mesh.triangleCount, 1);
  assert.equal(mesh.positions.length, 9);
  assert.deepEqual(Array.from(mesh.positions), [0, 0, 0, 1, 0, 0, 0, 1, 0]);
  assert.equal(mesh.normals[2], 1);
});

test('parses an ASCII STL triangle', () => {
  const ascii = `solid tri
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 2 0 0
    vertex 0 2 0
  endloop
endfacet
endsolid tri`;
  const mesh = parseStl(Buffer.from(ascii));
  assert.equal(mesh.format, 'ascii');
  assert.equal(mesh.triangleCount, 1);
  assert.deepEqual(Array.from(mesh.positions), [0, 0, 0, 2, 0, 0, 0, 2, 0]);
});

test('rejects bytes that are neither binary nor ASCII STL', () => {
  assert.throws(() => parseStl(Buffer.from('definitely not an stl file')), (error) => {
    assert.equal(error.status, 422);
    assert.equal(error.code, 'invalid_stl');
    return true;
  });
});

test('rejects non-finite binary vertices', () => {
  const buffer = binaryStl([[[0, 0, 0], [1, 0, 0], [0, 1, 0]]]);
  buffer.writeFloatLE(Number.NaN, 84 + 12);
  assert.throws(() => parseStl(buffer), /non-finite vertex/);
});

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

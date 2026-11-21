import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanMesh } from '../server/mesh.mjs';
import { meshToGlb } from '../server/glb.mjs';

test('writes a valid GLB container with positions, normals and indices', () => {
  const mesh = cleanMesh({
    positions: new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0,
      1, 0, 0, 1, 1, 0, 0, 1, 0,
    ]),
  });
  const glb = meshToGlb(mesh, { name: 'test-part' });

  assert.equal(glb.readUInt32LE(0), 0x46546c67);
  assert.equal(glb.readUInt32LE(4), 2);
  assert.equal(glb.readUInt32LE(8), glb.length);

  const jsonLength = glb.readUInt32LE(12);
  assert.equal(glb.readUInt32LE(16), 0x4e4f534a);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8').trim());

  assert.equal(json.asset.version, '2.0');
  assert.equal(json.meshes[0].name, 'test-part');
  assert.deepEqual(json.meshes[0].primitives[0].attributes, { POSITION: 1, NORMAL: 2 });
  assert.equal(json.accessors[0].count, mesh.indices.length);
  assert.equal(json.accessors[1].count, mesh.vertexCount);
  assert.equal(json.accessors[2].count, mesh.vertexCount);
  assert.deepEqual(json.accessors[1].min, mesh.bounds.min);
  assert.deepEqual(json.accessors[1].max, mesh.bounds.max);

  const binOffset = 20 + jsonLength;
  const binLength = glb.readUInt32LE(binOffset);
  assert.equal(glb.readUInt32LE(binOffset + 4), 0x004e4942);
  assert.equal(binLength, json.buffers[0].byteLength);
  assert.equal(binOffset + 8 + binLength, glb.length);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanMesh, simplifyMesh, centerMesh } from '../server/mesh.mjs';

test('welds duplicate vertices and rebuilds normals', () => {
  const mesh = cleanMesh({
    positions: new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0,
      0, 0, 0, 1, 0, 0, 0, 1, 0,
    ]),
  });
  assert.equal(mesh.vertexCount, 3);
  assert.equal(mesh.triangleCount, 1);
  assert.equal(mesh.removedTriangles, 1);
  assert.ok(Math.abs(mesh.normals[2] - 1) < 1e-6);
});

test('drops degenerate triangles', () => {
  const mesh = cleanMesh({
    positions: new Float32Array([
      0, 0, 0, 1, 1, 1, 2, 2, 2,
      0, 0, 0, 1, 0, 0, 0, 1, 0,
    ]),
  });
  assert.equal(mesh.triangleCount, 1);
  assert.equal(mesh.removedTriangles, 1);
});

test('simplifies dense meshes and centers them', () => {
  const grid = gridMesh(80, 2);
  const cleaned = cleanMesh({ positions: grid });
  assert.ok(cleaned.triangleCount > 10_000);

  const simplified = simplifyMesh(cleaned, 1_000);
  assert.equal(simplified.simplified, true);
  assert.ok(simplified.triangleCount < cleaned.triangleCount);
  assert.ok(simplified.triangleCount > 0);
  assert.ok(simplified.vertexCount > 0);

  const centered = centerMesh(simplified);
  assert.deepEqual(centered.center, [0, 0, 0]);
  assert.ok(centered.positions.length > 0);
});

function gridMesh(size, step) {
  const positions = [];
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      const x0 = x * step, y0 = y * step;
      const x1 = x0 + step, y1 = y0 + step;
      positions.push(x0, y0, 0, x1, y0, 0, x0, y1, 0);
      positions.push(x1, y0, 0, x1, y1, 0, x0, y1, 0);
    }
  }
  return new Float32Array(positions);
}

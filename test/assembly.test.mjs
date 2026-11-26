import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAssemblyModel } from '../src/import/assemblyModel.js';

function entry(name, radius, cloud = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])) {
  return {
    part: { name, desc: `${name} description`, color: '#4fe3e0', anchor: [0, 0, 0] },
    cloud,
    surface: { name: `${name}-surface` },
    radius,
  };
}

test('builds a multi-part assembly model', () => {
  const { modelDef, parts } = buildAssemblyModel([
    entry('Bracket', 2),
    entry('Shaft', 3),
  ], { name: 'Gearbox', radius: 8 });

  assert.equal(parts.length, 2);
  assert.deepEqual(parts.map((part) => part.name), ['Bracket', 'Shaft']);
  assert.equal(parts[0].instances[0].cloud.n, 3);
  assert.equal(parts[0].surface.name, 'Bracket-surface');
  assert.equal(modelDef.name, 'Gearbox');
  assert.equal(modelDef.assembly, true);
  assert.equal(modelDef.pack.json.radius, 8);
  assert.equal(modelDef.importStats.points, 6);
  assert.equal(modelDef.build(), parts);
});

test('builds an empty assembly shell', () => {
  const { modelDef, parts } = buildAssemblyModel([], { name: 'Empty' });

  assert.deepEqual(parts, []);
  assert.equal(modelDef.name, 'Empty');
  assert.equal(modelDef.subtitle, 'Empty assembly · import parts to start');
  assert.equal(modelDef.pack.json.radius, 2);
});

test('skips invalid entries and handles missing clouds', () => {
  const { parts } = buildAssemblyModel([
    null,
    { part: null },
    {
      part: { name: 'Loose part', color: '#ffaa44' },
      cloud: null,
      radius: 1,
    },
  ]);

  assert.equal(parts.length, 1);
  assert.equal(parts[0].name, 'Loose part');
  assert.deepEqual(parts[0].instances, []);
});

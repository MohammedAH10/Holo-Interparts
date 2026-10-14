import * as THREE from 'three';
import { loadModelFile } from '../import/loaders.js';
import { flattenAssembly, prettyName } from '../import/assembly.js';
import { sampleMesh, meshArea, groupBounds, centroid, recenterChunks } from '../import/sampler.ext.js';

function deriveExplode(cn, radius = 1) {
  const dir = [cn[0], cn[1], cn[2]];
  const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const scale = (radius * 0.4) / len;
  return { dir: [dir[0]*scale, dir[1]*scale, dir[2]*scale] };
}

function colorForName(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  const hue = ((h % 360) + 360) % 360;
  return `hsl(${hue}, 70%, 60%)`;
}

export async function addPartFromFile(file, pack, opts = {}) {
  const pointsPerUnit = opts.pointsPerUnit ?? 0.006;
  const root = await loadModelFile(file);
  const groups = flattenAssembly(root);
  if (!groups.length) throw new Error('No meshes found in file');

  const bounds = groupBounds(groups);
  const fileCenter = bounds.getCenter(new THREE.Vector3());
  const meta = pack?.json || pack || {};
  const origin = meta.origin || [fileCenter.x, fileCenter.y, fileCenter.z];
  const subtract = opts.align !== false ? origin : [fileCenter.x, fileCenter.y, fileCenter.z];

  let area = 0;
  for (const g of groups) {
    for (const m of g.meshes || [g.mesh].filter(Boolean)) {
      if (m.geometry) area += meshArea(m.geometry);
    }
  }

  const chunks = [];
  for (const g of groups) {
    const meshes = g.meshes || [g.mesh].filter(Boolean);
    for (const m of meshes) {
      if (!m.geometry) continue;
      const mArea = meshArea(m.geometry);
      const share = Math.max(50, Math.round((area * pointsPerUnit) * (mArea / Math.max(area, 1e-9))));
      chunks.push(sampleMesh(m.geometry, m.matrix || g.matrix || new THREE.Matrix4(), share));
    }
  }
  const cloud = recenterChunks(chunks, subtract[0], subtract[1], subtract[2]);
  if (!cloud.length) throw new Error('No points sampled');

  const cn = centroid(cloud);
  const { dir } = deriveExplode(cn, meta.radius || 2);
  const base = file.name.replace(/\.[^.]+$/, '');
  
  const part = {
    name: base,
    label: opts.label || prettyName(base),
    desc: opts.desc || 'Part imported from CAD file.',
    color: opts.color || colorForName(base),
    anchor: cn,
    dir,
    count: cloud.length / 3,
  };
  return { part, cloud };
}

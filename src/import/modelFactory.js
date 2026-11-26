import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { flattenAssembly, prettyName } from './assembly.js';
import { sampleMesh, meshArea, groupBounds, recenterChunks } from './sampler.ext.js';

const HOLO_COLOR = '#4fe3e0';

export function buildImportedModel(root, options = {}) {
  if (!root) throw new Error('No model was loaded');
  root.updateMatrixWorld?.(true);

  const groups = flattenAssembly(root);
  if (!groups.length) throw new Error('No geometry found in this file');

  const bounds = groupBounds(groups);
  const center = options.center
    ? new THREE.Vector3(options.center[0], options.center[1], options.center[2])
    : bounds.getCenter(new THREE.Vector3());
  const origin = options.origin
    ? [options.origin[0], options.origin[1], options.origin[2]]
    : [center.x, center.y, center.z];
  const size = bounds.getSize(new THREE.Vector3());

  let area = 0;
  for (const group of groups) {
    for (const mesh of group.meshes || [group.mesh].filter(Boolean)) {
      if (mesh.geometry) area += meshArea(mesh.geometry);
    }
  }

  const chunks = [];
  for (const group of groups) {
    for (const mesh of group.meshes || [group.mesh].filter(Boolean)) {
      if (!mesh.geometry) continue;
      const meshAreaValue = meshArea(mesh.geometry);
      const share = Math.max(100, Math.round((area * 0.004) * (meshAreaValue / Math.max(area, 1e-9))));
      chunks.push(sampleMesh(mesh.geometry, mesh.matrix || group.matrix || new THREE.Matrix4(), share));
    }
  }

  const cloud = recenterChunks(chunks, center.x, center.y, center.z);
  if (!cloud.length) throw new Error('No points could be sampled from this file');

  const baseName = options.fileName ? options.fileName.replace(/\.[^.]+$/, '') : 'Imported model';
  const displayName = options.name || prettyName(baseName);
  const subtitle = options.subtitle || (options.backendId
    ? 'Backend-processed STL · hologram surface'
    : 'User uploaded CAD');

  const instances = [{
    cloud: { p: cloud, n: cloud.length / 3 },
    anchor: [0, 0, 0],
  }];
  const surfaceGeometry = extractSurfaceGeometry(root, center);
  const packed = [{
    name: displayName,
    desc: options.description || 'Imported CAD design',
    color: options.color || HOLO_COLOR,
    instances,
    surface: surfaceGeometry,
  }];

  const modelDef = {
    id: options.backendId ? `backend-${options.backendId}` : `imported-${Date.now()}`,
    name: displayName,
    category: 'Imported',
    subtitle,
    view: { x: 0.25, y: -0.5, z: 0 },
    build: () => packed,
    parts: packed,
    pack: {
      json: {
        origin,
        radius: options.radius || size.length(),
        backendId: options.backendId || null,
      },
    },
    backendId: options.backendId || null,
    surface: surfaceGeometry ? { geometry: surfaceGeometry, color: options.surfaceColor || HOLO_COLOR } : null,
  };
  modelDef.importStats = {
    points: cloud.length / 3,
    triangles: options.triangleCount || countTriangles(groups),
    vertices: options.vertexCount || 0,
    radius: options.radius || size.length(),
  };

  return {
    modelDef,
    cloud,
    part: packed[0],
    stats: {
      points: cloud.length / 3,
      triangles: options.triangleCount || countTriangles(groups),
      vertices: options.vertexCount || 0,
      area,
      center: origin,
      radius: options.radius || size.length(),
      size: [size.x, size.y, size.z],
    },
  };
}

export function extractSurfaceGeometry(root, center) {
  const geometries = [];
  let triangleTotal = 0;

  root.traverse?.((object) => {
    if (!object.isMesh || !object.geometry) return;
    const source = object.geometry;
    const triCount = source.index ? source.index.count / 3 : source.getAttribute('position')?.count / 3 || 0;
    triangleTotal += triCount;
    if (triangleTotal > 700_000) return;

    let geometry = source.clone();
    geometry.applyMatrix4(object.matrixWorld);
    if (geometry.index) geometry = geometry.toNonIndexed();
    for (const name of Object.keys(geometry.attributes)) {
      if (name !== 'position' && name !== 'normal') geometry.deleteAttribute(name);
    }
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    geometry.clearGroups?.();
    geometries.push(geometry);
  });

  if (!geometries.length || triangleTotal > 700_000) return null;

  let merged = geometries[0];
  if (geometries.length > 1) {
    try {
      merged = mergeGeometries(geometries, false) || geometries[0];
    } catch {
      merged = geometries.reduce((best, geometry) => {
        const count = geometry.getAttribute('position')?.count || 0;
        const bestCount = best.getAttribute('position')?.count || 0;
        return count > bestCount ? geometry : best;
      }, geometries[0]);
    }
  }

  merged.translate(-center.x, -center.y, -center.z);
  merged.computeBoundingSphere();
  return merged;
}


function countTriangles(groups) {
  let triangles = 0;
  for (const group of groups) {
    for (const mesh of group.meshes || [group.mesh].filter(Boolean)) {
      const geometry = mesh.geometry;
      if (!geometry) continue;
      triangles += geometry.index ? geometry.index.count / 3 : (geometry.getAttribute('position')?.count || 0) / 3;
    }
  }
  return Math.round(triangles);
}

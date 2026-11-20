import { HttpError } from './http.mjs';

export function cleanMesh(input, { weldEpsilon = 1e-5 } = {}) {
  const positions = input?.positions;
  if (!positions || positions.length < 9 || positions.length % 9 !== 0) {
    throw new HttpError(422, 'STL mesh has no usable triangles', 'invalid_mesh');
  }

  const sourceTriangles = positions.length / 9;
  const unique = [];
  const lookup = new Map();
  const indices = [];
  const normals = [];
  const seenTriangles = new Set();
  let removed = 0;

  const vertexId = (x, y, z) => {
    const key = `${quantize(x, weldEpsilon)},${quantize(y, weldEpsilon)},${quantize(z, weldEpsilon)}`;
    let id = lookup.get(key);
    if (id === undefined) {
      id = unique.length / 3;
      lookup.set(key, id);
      unique.push(x, y, z);
      normals.push(0, 0, 0);
    }
    return id;
  };

  for (let t = 0; t < positions.length; t += 9) {
    const ax = positions[t], ay = positions[t + 1], az = positions[t + 2];
    const bx = positions[t + 3], by = positions[t + 4], bz = positions[t + 5];
    const cx = positions[t + 6], cy = positions[t + 7], cz = positions[t + 8];

    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const area2 = Math.hypot(nx, ny, nz);
    if (!(area2 > 1e-12)) {
      removed++;
      continue;
    }

    const a = vertexId(ax, ay, az);
    const b = vertexId(bx, by, bz);
    const c = vertexId(cx, cy, cz);
    if (a === b || b === c || a === c) {
      removed++;
      continue;
    }

    const sorted = [a, b, c].sort((x, y) => x - y);
    const triKey = `${sorted[0]}:${sorted[1]}:${sorted[2]}`;
    if (seenTriangles.has(triKey)) {
      removed++;
      continue;
    }
    seenTriangles.add(triKey);
    indices.push(a, b, c);

    const inv = 1 / area2;
    const n0 = nx * inv, n1 = ny * inv, n2 = nz * inv;
    for (const v of [a, b, c]) {
      const k = v * 3;
      normals[k] += n0;
      normals[k + 1] += n1;
      normals[k + 2] += n2;
    }
  }

  if (indices.length === 0) {
    throw new HttpError(422, 'STL mesh contains no non-degenerate triangles', 'invalid_mesh');
  }

  return finalizeMesh(new Float32Array(unique), new Uint32Array(indices), normals, {
    sourceTriangleCount: sourceTriangles,
    removedTriangles: removed,
    simplified: false,
  });
}

export function simplifyMesh(mesh, maxTriangles = 250_000) {
  const currentTriangles = mesh.indices.length / 3;
  if (!Number.isFinite(maxTriangles) || maxTriangles <= 0 || currentTriangles <= maxTriangles) {
    return { ...mesh, simplified: false, sourceTriangleCount: mesh.sourceTriangleCount || currentTriangles };
  }

  const { min, max } = mesh.bounds;
  const extent = [Math.max(max[0] - min[0], 1e-9), Math.max(max[1] - min[1], 1e-9), Math.max(max[2] - min[2], 1e-9)];
  const divisions = Math.max(12, Math.min(512, Math.ceil(Math.cbrt(maxTriangles * 0.55))));
  const cells = divisions ** 3;
  const sums = new Float64Array(cells * 3);
  const counts = new Uint32Array(cells);
  const keys = new Int32Array(mesh.positions.length / 3);

  for (let v = 0; v < mesh.positions.length / 3; v++) {
    const x = (mesh.positions[v * 3] - min[0]) / extent[0];
    const y = (mesh.positions[v * 3 + 1] - min[1]) / extent[1];
    const z = (mesh.positions[v * 3 + 2] - min[2]) / extent[2];
    const ix = Math.min(divisions - 1, Math.max(0, Math.floor(x * divisions)));
    const iy = Math.min(divisions - 1, Math.max(0, Math.floor(y * divisions)));
    const iz = Math.min(divisions - 1, Math.max(0, Math.floor(z * divisions)));
    const key = (iz * divisions + iy) * divisions + ix;
    keys[v] = key;
    counts[key]++;
    sums[key * 3] += mesh.positions[v * 3];
    sums[key * 3 + 1] += mesh.positions[v * 3 + 1];
    sums[key * 3 + 2] += mesh.positions[v * 3 + 2];
  }

  const clusterVertex = new Int32Array(cells).fill(-1);
  const positions = [];
  for (let key = 0; key < cells; key++) {
    if (counts[key] === 0) continue;
    clusterVertex[key] = positions.length / 3;
    positions.push(
      sums[key * 3] / counts[key],
      sums[key * 3 + 1] / counts[key],
      sums[key * 3 + 2] / counts[key],
    );
  }

  const triangles = [];
  const seen = new Set();
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = clusterVertex[keys[mesh.indices[i]]];
    const b = clusterVertex[keys[mesh.indices[i + 1]]];
    const c = clusterVertex[keys[mesh.indices[i + 2]]];
    if (a === b || b === c || a === c) continue;
    const sorted = [a, b, c].sort((x, y) => x - y);
    const key = `${sorted[0]}:${sorted[1]}:${sorted[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    triangles.push(a, b, c);
  }

  const result = finalizeMesh(new Float32Array(positions), new Uint32Array(triangles), null, {
    sourceTriangleCount: mesh.sourceTriangleCount || currentTriangles,
    removedTriangles: mesh.removedTriangles || 0,
    simplified: true,
  });
  return result;
}

export function centerMesh(mesh) {
  const [cx, cy, cz] = mesh.center;
  const positions = new Float32Array(mesh.positions.length);
  for (let i = 0; i < mesh.positions.length; i += 3) {
    positions[i] = mesh.positions[i] - cx;
    positions[i + 1] = mesh.positions[i + 1] - cy;
    positions[i + 2] = mesh.positions[i + 2] - cz;
  }
  const half = [
    (mesh.bounds.max[0] - mesh.bounds.min[0]) / 2,
    (mesh.bounds.max[1] - mesh.bounds.min[1]) / 2,
    (mesh.bounds.max[2] - mesh.bounds.min[2]) / 2,
  ];
  return {
    ...mesh,
    positions,
    bounds: { min: [-half[0], -half[1], -half[2]], max: half },
    center: [0, 0, 0],
  };
}

function finalizeMesh(positions, indices, normals, extra) {
  const bounds = computeBounds(positions);
  if (normals) {
    const out = new Float32Array(normals.length);
    for (let i = 0; i < normals.length; i += 3) {
      const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
      if (len < 1e-12) {
        out[i] = 0; out[i + 1] = 0; out[i + 2] = 1;
      } else {
        out[i] = normals[i] / len;
        out[i + 1] = normals[i + 1] / len;
        out[i + 2] = normals[i + 2] / len;
      }
    }
    return finish(positions, out, indices, bounds, extra);
  }
  return finish(positions, computeNormals(positions, indices), indices, bounds, extra);
}

function finish(positions, normals, indices, bounds, extra) {
  const center = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
  const radius = Math.hypot(
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  ) / 2;
  return {
    positions,
    normals,
    indices,
    bounds,
    center,
    radius,
    triangleCount: indices.length / 3,
    vertexCount: positions.length / 3,
    ...extra,
  };
}

function computeNormals(positions, indices) {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (const v of [a, b, c]) {
      normals[v] += nx;
      normals[v + 1] += ny;
      normals[v + 2] += nz;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
    if (len < 1e-12) {
      normals[i] = 0; normals[i + 1] = 0; normals[i + 2] = 1;
    } else {
      normals[i] /= len;
      normals[i + 1] /= len;
      normals[i + 2] /= len;
    }
  }
  return normals;
}

function computeBounds(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const value = positions[i + a];
      if (value < min[a]) min[a] = value;
      if (value > max[a]) max[a] = value;
    }
  }
  return { min, max };
}

function quantize(value, epsilon) {
  return Math.round(value / epsilon);
}

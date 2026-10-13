import * as THREE from 'three';

export function geometryToPoints(geometry, { density = 15000, seed = 12345 } = {}) {
  const geo = geometry.clone();
  geo.computeBoundingBox();
  geo.computeVertexNormals();
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  
  const positionAttr = geo.getAttribute('position');
  if (!positionAttr) {
    throw new Error('Geometry has no position attribute');
  }
  
  const faces = [];
  const pos = positionAttr.array;
  if (geo.index) {
    const idx = geo.index.array;
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      faces.push([a,b,c]);
    }
  } else {
    for (let i = 0; i < pos.length; i += 9) {
      faces.push([i, i+3, i+6]);
    }
  }
  
  const rng = mulberry32(seed);
  const areas = [];
  let totalArea = 0;
  for (const f of faces) {
    const area = triangleArea(pos, f[0], f[1], f[2]);
    areas.push(area);
    totalArea += area;
  }
  
  const points = [];
  const targetCount = Math.max(100, Math.min(500000, Math.floor(density)));
  const pointPerUnit = targetCount / Math.max(totalArea, 1e-9);
  
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i];
    const area = areas[i];
    let count = Math.floor(area * pointPerUnit + rng());
    if (count < 1 && area > 0) count = 1;
    for (let j = 0; j < count; j++) {
      const r1 = rng(), r2 = rng();
      const s = Math.sqrt(r1);
      const u = 1 - s, v = s * r2;
      const w = 1 - u - v;
      const p = randomPoint(pos, f[0], f[1], f[2], u, v, w);
      points.push(p[0], p[1], p[2]);
    }
  }
  
  return new Float32Array(points);
}

function triangleArea(pos, a,b,c) {
  const ax=pos[a], ay=pos[a+1], az=pos[a+2];
  const bx=pos[b], by=pos[b+1], bz=pos[b+2];
  const cx=pos[c], cy=pos[c+1], cz=pos[c+2];
  const v1x=bx-ax, v1y=by-ay, v1z=bz-az;
  const v2x=cx-ax, v2y=cy-ay, v2z=cz-az;
  const cx1=v1y*v2z-v1z*v2y, cy1=v1z*v2x-v1x*v2z, cz1=v1x*v2y-v1y*v2x;
  return 0.5 * Math.sqrt(cx1*cx1+cy1*cy1+cz1*cz1);
}

function randomPoint(pos,a,b,c,u,v,w) {
  return [
    pos[a]*u + pos[b]*v + pos[c]*w,
    pos[a+1]*u + pos[b+1]*v + pos[c+1]*w,
    pos[a+2]*u + pos[b+2]*v + pos[c+2]*w
  ];
}

function mulberry32(a) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

import * as THREE from 'three';
import { geometryToPoints } from './sampler.js';

export function meshArea(geometry) {
  const pos = geometry.getAttribute('position');
  if (!pos) return 0;
  const faces = [];
  if (geometry.index) {
    const idx = geometry.index.array;
    for (let i = 0; i < idx.length; i += 3) {
      faces.push([idx[i]*3, idx[i+1]*3, idx[i+2]*3]);
    }
  } else {
    for (let i = 0; i < pos.count; i += 3) {
      faces.push([i*3, (i+1)*3, (i+2)*3]);
    }
  }
  let area = 0;
  const p = pos.array;
  for (const f of faces) {
    const a=p[f[0]], b=p[f[0]+1], c=p[f[0]+2];
    const d=p[f[1]], e=p[f[1]+1], g=p[f[1]+2];
    const h=p[f[2]], j=p[f[2]+1], k=p[f[2]+2];
    const v1x=d-a,v1y=e-b,v1z=g-c;
    const v2x=h-a,v2y=j-b,v2z=k-c;
    const crx=v1y*v2z-v1z*v2y, cry=v1z*v2x-v1x*v2z, crz=v1x*v2y-v1y*v2x;
    area += 0.5*Math.sqrt(crx*crx+cry*cry+crz*crz);
  }
  return area;
}

export function groupBounds(groups) {
  const box = new THREE.Box3();
  for (const g of groups) {
    if (!g.mesh.geometry.boundingBox) g.mesh.geometry.computeBoundingBox();
    const b = g.mesh.geometry.boundingBox.clone();
    b.applyMatrix4(g.matrix);
    box.union(b);
  }
  return box;
}

export function centroid(cloud) {
  if (!cloud || cloud.length < 3) return [0,0,0];
  let x=0,y=0,z=0, n=cloud.length/3;
  for (let i=0;i<n;i++) { x+=cloud[i*3]; y+=cloud[i*3+1]; z+=cloud[i*3+2]; }
  return [x/n,y/n,z/n];
}

export function recenterChunks(chunks, sx,sy,sz) {
  const out=[];
  for (let i=0;i<chunks.length;i++) {
    const c=chunks[i];
    for (let j=0;j<c.length;j+=3) out.push(c[j]-sx,c[j+1]-sy,c[j+2]-sz);
  }
  return new Float32Array(out);
}

export function concatFloat32(arrs) {
  let len=0; for (const a of arrs) len+=a.length;
  const res=new Float32Array(len); let off=0;
  for (const a of arrs) { res.set(a,off); off+=a.length; }
  return res;
}

export function sampleMesh(geometry, matrix, count) {
  const geo = geometry.clone();
  geo.applyMatrix4(matrix);
  return geometryToPoints(geo, { density: Math.max(100, count*3), seed: Math.floor(Math.random()*100000) });
}

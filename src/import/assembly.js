import * as THREE from 'three';

export function flattenAssembly(root) {
  const groups = [];
  const visited = new Set();
  
  function traverse(obj, parentMatrix = new THREE.Matrix4()) {
    if (!obj) return;
    if (visited.has(obj.uuid)) return;
    visited.add(obj.uuid);
    
    const matrix = parentMatrix.clone().multiply(obj.matrix);
    
    if (obj.isMesh) {
      groups.push({
        mesh: obj,
        matrix: matrix.clone(),
        name: obj.name || obj.parent?.name || 'mesh'
      });
    }
    
    if (obj.children) {
      for (const child of obj.children) {
        traverse(child, matrix);
      }
    }
  }
  
  if (root.isObject3D) {
    traverse(root);
  }
  
  return groups;
}

export function prettyName(name) {
  if (!name) return 'Part';
  return String(name)
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

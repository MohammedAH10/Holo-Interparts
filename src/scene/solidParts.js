import * as THREE from 'three';

export class SolidPartLayer {
  constructor(parent) {
    this.parent = parent;
    this.group = new THREE.Group();
    this.group.name = 'solid-parts';
    parent.add(this.group);
    this.enabled = true;
    this.entries = [];
    this.count = 0;
  }

  setParts(parts) {
    this.clear();
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part?.surface) continue;
      const color = new THREE.Color(part.color || '#4fe3e0');
      const material = new THREE.MeshStandardMaterial({
        color,
        emissive: color.clone().multiplyScalar(0.35),
        emissiveIntensity: 0.6,
        metalness: 0.35,
        roughness: 0.4,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(part.surface, material);
      mesh.name = `solid-${part.name || i}`;
      mesh.frustumCulled = false;
      this.group.add(mesh);

      let edges = null;
      const triangles = part.surface.index
        ? part.surface.index.count / 3
        : (part.surface.getAttribute('position')?.count || 0) / 3;
      if (triangles > 0 && triangles <= 180_000) {
        const edgeGeometry = new THREE.EdgesGeometry(part.surface, 34);
        const edgeMaterial = new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: 0.42,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
        edges.frustumCulled = false;
        mesh.add(edges);
      }

      this.entries.push({ index: i, mesh, edges, material, baseEmissive: 0.6 });
    }
    this.count = this.entries.length;
    this.group.visible = this.enabled && this.count > 0;
  }

  update(offsets, hover = -1, selected = -1) {
    for (const entry of this.entries) {
      const offset = offsets[entry.index];
      if (offset) entry.mesh.position.copy(offset);
      const hot = entry.index === hover || entry.index === selected;
      entry.material.emissiveIntensity = hot ? 1.35 : entry.baseEmissive;
      if (entry.edges) entry.edges.material.opacity = hot ? 0.85 : 0.42;
    }
    this.group.visible = this.enabled && this.count > 0;
  }

  setEnabled(enabled) {
    this.enabled = enabled !== false;
    this.group.visible = this.enabled && this.count > 0;
  }

  clear() {
    for (const entry of this.entries) {
      this.group.remove(entry.mesh);
      entry.material.dispose();
      if (entry.edges) {
        entry.mesh.remove(entry.edges);
        entry.edges.geometry.dispose();
        entry.edges.material.dispose();
      }
    }
    this.entries = [];
    this.count = 0;
    this.group.visible = false;
  }
}

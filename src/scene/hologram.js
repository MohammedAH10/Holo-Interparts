import * as THREE from 'three';

const VERT = /* glsl */ `
uniform float uTime;
varying vec3 vNormalView;
varying vec3 vViewDir;
varying vec3 vLocal;

void main() {
  vec3 p = position;
  float breathe = sin(uTime * 1.7 + p.y * 4.0 + p.x * 2.0) * 0.0018;
  p += normal * breathe;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vNormalView = normalize(normalMatrix * normal);
  vViewDir = normalize(-mv.xyz);
  vLocal = p;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uFade;
uniform float uStrength;
varying vec3 vNormalView;
varying vec3 vViewDir;
varying vec3 vLocal;

void main() {
  float facing = abs(dot(normalize(vNormalView), normalize(vViewDir)));
  float fresnel = pow(1.0 - facing, 2.1);
  float scan = 0.74 + 0.26 * sin(vLocal.y * 24.0 - uTime * 4.2);
  float sweep = 0.88 + 0.12 * sin(vLocal.x * 12.0 + uTime * 1.8);
  float bands = 0.94 + 0.06 * sin(vLocal.z * 38.0 + uTime * 2.4);
  float alpha = (0.055 + fresnel * 0.72) * scan * sweep * bands * uFade * uStrength;
  if (alpha < 0.002) discard;
  gl_FragColor = vec4(uColor * (0.72 + fresnel * 2.0), alpha);
}`;

export class HologramLayer {
  constructor(parent, { color = '#4fe3e0' } = {}) {
    this.parent = parent;
    this.group = new THREE.Group();
    this.group.name = 'hologram-surface';
    parent.add(this.group);

    this.enabled = true;
    this.mesh = null;
    this.edges = null;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uTime: { value: 0 },
        uFade: { value: 1 },
        uStrength: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.edgeMaterial = new THREE.LineBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }

  setSurface(surface) {
    this.clear();
    if (!surface?.geometry) {
      this.group.visible = false;
      return;
    }

    const color = surface.color || '#4fe3e0';
    this.material.uniforms.uColor.value.set(color);
    this.edgeMaterial.color.set(color);

    this.mesh = new THREE.Mesh(surface.geometry, this.material);
    this.mesh.name = 'hologram-mesh';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.group.add(this.mesh);

    const position = surface.geometry.getAttribute('position');
    const triangles = surface.geometry.index
      ? surface.geometry.index.count / 3
      : (position?.count || 0) / 3;
    if (triangles > 0 && triangles <= 350_000) {
      const edgesGeometry = new THREE.EdgesGeometry(surface.geometry, 38);
      this.edges = new THREE.LineSegments(edgesGeometry, this.edgeMaterial);
      this.edges.name = 'hologram-edges';
      this.edges.frustumCulled = false;
      this.edges.renderOrder = 3;
      this.group.add(this.edges);
    }
  }

  setEnabled(enabled) {
    this.enabled = enabled !== false;
    this.update({ time: 0, explode: 0, intensity: 1 });
  }

  update({ time = 0, explode = 0, intensity = 1 } = {}) {
    this.material.uniforms.uTime.value = time;
    const shown = Math.min(1, Math.max(0, explode * intensity));
    const fade = 1 - smoothstep(0.02, 0.34, shown);
    this.material.uniforms.uFade.value = fade;
    this.edgeMaterial.opacity = 0.32 * fade;
    this.group.visible = !!(this.enabled && this.mesh && fade > 0.004);
  }

  clear() {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh = null;
    }
    if (this.edges) {
      this.group.remove(this.edges);
      this.edges.geometry.dispose();
      this.edges = null;
    }
    this.group.visible = false;
  }
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

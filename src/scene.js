import * as THREE from 'three';
import { clamp, damp } from './utils.js';
import { SolidPartLayer } from './scene/solidParts.js';
import { normalizePartGroups, groupMembers, mergePartGroups, resetPartGroups } from './assembly/groups.js';

const MAXP = 24; // max parts per model (must match the shader array size)
const CAM_Z = 9.5;
const FOV = 38;
const FIT = 2.7;

const VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aPart;
attribute vec3 aRand;
attribute float aSeed;
uniform float uTime;
uniform float uSize;
uniform float uPR;
uniform float uScatter;
uniform float uHi;
uniform float uSel;
uniform vec3 uOff[${MAXP}];
varying vec3 vColor;
varying float vA;
void main() {
  int idx = int(aPart + 0.5);
  vec3 p = position + uOff[idx];
  p += 0.010 * vec3(sin(uTime * 1.3 + aSeed * 40.0), cos(uTime * 1.1 + aSeed * 31.0), sin(uTime * 0.9 + aSeed * 23.0));
  p += aRand * uScatter * 4.0;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float hi = abs(aPart - uHi) < 0.5 ? 1.0 : 0.0;
  float sel = abs(aPart - uSel) < 0.5 ? 1.0 : 0.0;
  float tw = 0.82 + 0.18 * sin(uTime * 2.0 + aSeed * 60.0);
  float boost = max(hi, sel);
  gl_PointSize = uSize * uPR * (0.8 + 0.5 * fract(aSeed * 7.13)) * (1.0 + 0.7 * boost) * (${CAM_Z.toFixed(1)} / -mv.z);
  vColor = mix(aColor * tw, vec3(1.0), 0.45 * boost);
  vA = (0.9 - 0.9 * uScatter) * (1.0 + 0.2 * boost);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.05, d);
  gl_FragColor = vec4(vColor, a * vA);
}`;

function hexRgb(hex) {
  if (!hex) return [0.5, 0.5, 1.0];
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export class HoloScene {
  constructor(canvas, models = []) {
    this.models = models;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
    this.camera.position.set(0, 0, CAM_Z);
    this.scene = new THREE.Scene();
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.solidParts = new SolidPartLayer(this.group);
    this.surfaceEnabled = true;
    this.solidAll = false;

    this.scene.add(new THREE.AmbientLight(0x8899ff, 0.8));
    const keyLight = new THREE.DirectionalLight(0x9fe8ff, 2.1);
    keyLight.position.set(6, 8, 10);
    this.scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xffb05a, 0.9);
    fillLight.position.set(-8, -4, -6);
    this.scene.add(fillLight);

    this.uniforms = {
      uTime: { value: 0 },
      uSize: { value: 2.7 },
      uPR: { value: 1 },
      uScatter: { value: 1 },
      uHi: { value: -1 },
      uSel: { value: -1 },
      uOff: { value: Array.from({ length: MAXP }, () => new THREE.Vector3()) },
    };
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });

    this.rot = { x: 0, y: 0, z: 0 };
    this.vel = { x: 0, y: 0 };
    this.scale = 1;
    this.scaleTarget = 1;
    this.holdVel = false;
    this.autoSpin = true;
    this.idle = 0;
    this.scatterTarget = 0;
    this.pending = -1;
    this.index = -1;
    this.hover = -1;
    this.sel = -1;
    this.shift = 0;
    this.offT = Array.from({ length: MAXP }, () => new THREE.Vector3());
    this.cache = new Map();
    this.partGroups = [];
    this.modelRadius = 1;
    this.onModel = null;
    this.currentPack = null;
    this.panelVisible = true;

    this.resize();
    addEventListener('resize', () => this.resize());
    if (models.length > 0) {
      this._load(0);
    }
  }

  get partCount() {
    return this.parts ? this.parts.length : 0;
  }
  resize() {
    const W = innerWidth, H = innerHeight;
    this.W = W;
    this.H = H;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.setSize(W, H, false);
    this.camera.aspect = W / H;
    this.camera.updateProjectionMatrix();
    this.uniforms.uPR.value = this.renderer.getPixelRatio();
    const unitsPerPx = (2 * Math.tan((FOV * Math.PI) / 360) * CAM_Z) / H;
    const panel = this.panelVisible !== false && W > 900 ? 300 : 0;
    this.shift = (panel / 2) * unitsPerPx;
    this.unitsPerPx = unitsPerPx;
  }

  setPanelVisible(visible) {
    visible = visible !== false;
    if (visible === this.panelVisible) return;
    this.panelVisible = visible;
    this.resize();
  }

  getPack() {
    return this.currentPack;
  }

  appendPart(partData, cloud) {
    return this.appendParts([{ part: partData, cloud }]);
  }

  appendParts(items) {
    const def = this.models[this.index];
    if (!def || !Array.isArray(items) || items.length === 0) return 0;
    const room = MAXP - (this.parts?.length || 0);
    if (room <= 0) return 0;
    if (!def.extraParts) def.extraParts = [];
    let added = 0;
    for (const item of items.slice(0, room)) {
      const partData = item?.part;
      const cloud = item?.cloud;
      if (!partData) continue;
      const instances = [];
      if (cloud && (cloud.length || cloud.p?.length)) {
        instances.push({ cloud, anchor: partData.anchor || [0, 0, 0] });
      }
      def.extraParts.push({
        name: partData.name || 'Part',
        desc: partData.desc || '',
        color: partData.color || '#ffaa44',
        instances,
        surface: partData.surface || item.surface || null,
      });
      added++;
    }
    if (!added) return 0;
    this.cache.delete(this.index);
    this.releaseAll(true);
    this.pending = this.index;
    this.scatterTarget = 1;
    return added;
  }

  _geometry(i) {
    if (this.cache.has(i)) return this.cache.get(i);
    const def = this.models[i];
    const parts = (def.build ? def.build() : (def.parts || [])).slice();
    if (def.extraParts) parts.push(...def.extraParts);
    let total = 0;
    for (const p of parts) {
      for (const inst of p.instances || []) {
        total += (inst.cloud?.n || (inst.cloud?.length / 3) || 0);
      }
    }

    const mn = [1e9,1e9,1e9], mx = [-1e9,-1e9,-1e9];
    for (const p of parts) {
      for (const inst of p.instances || []) {
        const q = inst.cloud?.p || inst.cloud;
        if (!q) continue;
        const len = inst.cloud?.n ? inst.cloud.n * 3 : q.length;
        for (let k = 0; k < len; k += 3) {
          for (let a = 0; a < 3; a++) {
            const v = q[k + a];
            if (v < mn[a]) mn[a] = v;
            if (v > mx[a]) mx[a] = v;
          }
        }
      }
    }
    const c = [0,1,2].map(a => (mn[a]+mx[a])/2);

    const pos = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
    const part = new Float32Array(total);
    const rnd = new Float32Array(total * 3);
    const seed = new Float32Array(total);
    let maxR = 0;
    let k = 0;
    const meta = [];
    parts.forEach((p, pi) => {
      const rgb = hexRgb(p.color);
      const anchors = [];
      const samples = [];
      (p.instances || []).forEach(inst => {
        const a = inst.anchor || [0, 0, 0];
        anchors.push({ a: [a[0] - c[0], a[1] - c[1], a[2] - c[2]] });
        const q = inst.cloud?.p || inst.cloud;
        if (!q) return;
        const n = inst.cloud?.n || (q.length / 3);
        for (let i = 0; i < n; i++, k++) {
          const x = q[i*3] - c[0], y = q[i*3+1] - c[1], z = q[i*3+2] - c[2];
          pos.set([x,y,z], k*3);
          const br = 0.78 + 0.32 * Math.random();
          col.set([rgb[0]*br, rgb[1]*br, rgb[2]*br], k*3);
          part[k] = pi;
          const rr = Math.random(), tt = Math.random()*Math.PI*2, uu = Math.random()*2-1;
          const s = Math.sqrt(1-uu*uu);
          rnd.set([s*Math.cos(tt)*rr, uu*rr, s*Math.sin(tt)*rr], k*3);
          seed[k] = Math.random();
          maxR = Math.max(maxR, Math.hypot(x, y, z));
          if (Math.random() < 160 / Math.max(160, n)) samples.push(x, y, z);
        }
      });
      let cx = 0, cy = 0, cz = 0, sn = 0;
      for (let si = 0; si < samples.length; si += 3) {
        cx += samples[si]; cy += samples[si + 1]; cz += samples[si + 2];
        sn++;
      }
      const inv = sn ? 1 / sn : 0;
      meta.push({
        name: p.name,
        desc: p.desc || '',
        color: p.color || '#7fa3ff',
        anchors,
        samples: new Float32Array(samples),
        center: [cx * inv, cy * inv, cz * inv],
        surface: p.surface || null,
      });
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aPart', new THREE.BufferAttribute(part, 1));
    geo.setAttribute('aRand', new THREE.BufferAttribute(rnd, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50);
    const entry = { geo, meta, fit: FIT / Math.max(0.5, maxR), count: total, radius: Math.max(0.5, maxR), sources: parts, center: c };
    this.cache.set(i, entry);
    return entry;
  }

  _load(i) {
    if (!this.models[i]) return;
    const g = this._geometry(i);
    if (this.points) this.group.remove(this.points);
    this.points = new THREE.Points(g.geo, this.material);
    this.points.frustumCulled = false;
    this.group.add(this.points);
    this.parts = g.meta;
    this.partSources = g.sources || [];
    this.solidParts.setParts(this.parts, g.center);
    this.solidAll = this.parts.length > 0 && this.solidParts.count === this.parts.length;
    this.points.visible = !this.solidAll || !this.surfaceEnabled;
    this.fit = g.fit;
    this.count = g.count;
    this.modelRadius = g.radius || 1;
    this.partGroups = normalizePartGroups(this.models[i]?.partGroups, g.meta.length);
    this.models[i].partGroups = this.partGroups.slice();
    this.index = i;
    this.hover = -1;
    this.sel = -1;
    this.uniforms.uHi.value = -1;
    this.uniforms.uSel.value = -1;
    this.releaseAll(true);
    const def = this.models[i];
    const v = def.view || { x: 0, y: 0, z: 0 };
    this.rot.x = v.x; this.rot.y = v.y; this.rot.z = v.z;
    this.vel.x = this.vel.y = 0;
    this.scatterTarget = 0;
    this.currentPack = def.pack || def;
    if (this.onModel) this.onModel(i, def, g);
  }

  setModel(i) {
    const n = this.models.length;
    if (n === 0) return;
    i = ((i % n) + n) % n;
    if (i === this.index && this.pending < 0) return;
    this.pending = i;
    this.scatterTarget = 1;
  }
  next(d = 1) { this.setModel((this.pending >= 0 ? this.pending : this.index) + d); }

  setHologramEnabled(enabled) {
    this.surfaceEnabled = enabled !== false;
    this.solidParts.setEnabled(this.surfaceEnabled);
    if (this.points) this.points.visible = !this.solidAll || !this.surfaceEnabled;
  }
  get hasSurface() {
    return this.solidParts.count > 0;
  }
  setHover(i) { this.hover = i; this.uniforms.uHi.value = i; }
  setSel(i) { this.sel = i; this.uniforms.uSel.value = i; }
  setPartName(i, value) {
    if (!this.parts?.[i]) return false;
    const name = String(value || '').trim().slice(0, 60);
    if (!name) return false;
    this.parts[i].name = name;
    const source = this.partSources?.[i];
    if (source) source.name = name;
    return true;
  }
  setPartDesc(i, value) {
    if (!this.parts?.[i]) return false;
    const desc = String(value || '').trim().slice(0, 240);
    this.parts[i].desc = desc;
    const source = this.partSources?.[i];
    if (source) source.desc = desc;
    return true;
  }
  rotateBy(dyaw, dpitch, dt = 1/60) {
    this.rot.y += dyaw;
    this.rot.x = clamp(this.rot.x + dpitch, -1.4, 1.4);
    this.vel.y += (dyaw/Math.max(dt,0.008) - this.vel.y)*0.3;
    this.vel.x += (dpitch/Math.max(dt,0.008) - this.vel.x)*0.3;
    this.idle = 0;
  }
  rollBy(d) { this.rot.z = clamp(this.rot.z + d, -1.2, 1.2); this.idle = 0; }
  zoomBy(f) { this.scaleTarget = clamp(this.scaleTarget * f, 0.5, 2.6); }
  resetView() {
    const def = this.models[this.index] || {};
    const v = def.view || { x:0,y:0,z:0 };
    this.rot.x = v.x; this.rot.y = v.y; this.rot.z = v.z;
    this.vel.x = this.vel.y = 0;
    this.scaleTarget = 1;
    this.releaseAll();
    this.setSel(-1);
  }
  dragPart(i, dx, dy) {
    if (i < 0 || i >= (this.parts?.length || 0)) return;
    const v = new THREE.Vector3(dx * this.unitsPerPx, -dy * this.unitsPerPx, 0);
    v.applyQuaternion(this.group.quaternion.clone().invert()).divideScalar(Math.max(1e-4, this.group.scale.x));
    const members = groupMembers(this.partGroups, i);
    const targets = members.length ? members : [i];
    for (const part of targets) this.offT[part].add(v);
    this.idle = 0;
  }

  partGroupSize(i) {
    return groupMembers(this.partGroups, i).length;
  }

  partCenter(i) {
    const part = this.parts?.[i];
    if (!part) return [0, 0, 0];
    const off = this.uniforms.uOff.value[i];
    const c = part.center || [0, 0, 0];
    return [c[0] + off.x, c[1] + off.y, c[2] + off.z];
  }

  lockParts(a, b) {
    if (!this.parts || a === b) return false;
    if (!mergePartGroups(this.partGroups, a, b)) return false;
    const def = this.models[this.index];
    if (def) def.partGroups = this.partGroups.slice();
    this.idle = 0;
    return true;
  }

  lockNearest(i, maxDistance) {
    if (!this.parts || i < 0 || i >= this.parts.length) return -1;
    const origin = this.partCenter(i);
    const group = this.partGroups[i];
    const limit = maxDistance ?? this.modelRadius * 0.45;
    let best = -1;
    let bestDistance = limit;
    for (let j = 0; j < this.parts.length; j++) {
      if (j === i || this.partGroups[j] === group) continue;
      const c = this.partCenter(j);
      const d = Math.hypot(c[0] - origin[0], c[1] - origin[1], c[2] - origin[2]);
      if (d < bestDistance) {
        bestDistance = d;
        best = j;
      }
    }
    return best;
  }

  unlockAll() {
    resetPartGroups(this.partGroups);
    const def = this.models[this.index];
    if (def) def.partGroups = this.partGroups.slice();
    this.idle = 0;
  }

  lockSegments() {
    if (!this.parts?.length || !this.partGroups?.length) return [];
    const v = new THREE.Vector3();
    const out = [];
    const done = new Set();
    this.group.updateMatrixWorld(true);
    for (let i = 0; i < this.parts.length; i++) {
      if (this.partGroupSize(i) < 2 || done.has(this.partGroups[i])) continue;
      done.add(this.partGroups[i]);
      const members = groupMembers(this.partGroups, i);
      const a = this.partCenter(members[0]);
      const sa = this._toScreen(a, v);
      for (let k = 1; k < members.length; k++) {
        const b = this.partCenter(members[k]);
        const sb = this._toScreen(b, v);
        out.push({ a: sa, b: sb, color: this.parts[members[k]]?.color || '#4fe3e0' });
      }
    }
    return out;
  }
  releaseAll(snap = false) {
    for (let i = 0; i < MAXP; i++) {
      this.offT[i].set(0,0,0);
      if (snap) this.uniforms.uOff.value[i].set(0,0,0);
    }
  }

  _toScreen(local, out) {
    out.set(local[0], local[1], local[2]).applyMatrix4(this.group.matrixWorld).project(this.camera);
    return { x: (out.x*0.5+0.5)*this.W, y: (-out.y*0.5+0.5)*this.H, z: out.z };
  }

  pick(px, py, maxDist = 100) {
    const v = new THREE.Vector3();
    let best = -1, bd = maxDist;
    this.group.updateMatrixWorld(true);
    this.parts?.forEach((p, i) => {
      const s = p.samples;
      const off = this.uniforms.uOff.value[i];
      for (let k = 0; k < s.length; k += 3) {
        const sp = this._toScreen([s[k]+off.x, s[k+1]+off.y, s[k+2]+off.z], v);
        const d = Math.hypot(sp.x-px, sp.y-py);
        if (d < bd) { bd = d; best = i; }
      }
    });
    return best;
  }

  labelPoints() {
    const v = new THREE.Vector3();
    this.group.updateMatrixWorld(true);
    return (this.parts || []).map((p, i) => {
      const a = p.anchors?.[0]?.a || [0,0,0];
      const off = this.uniforms.uOff.value[i];
      const s = this._toScreen([a[0]+off.x, a[1]+off.y, a[2]+off.z], v);
      return { i, x: s.x, y: s.y, name: p.name, color: p.color };
    });
  }
  centerScreen() {
    const v = new THREE.Vector3();
    this.group.updateMatrixWorld(true);
    return this._toScreen([0,0,0], v);
  }

  update(dt, t) {
    this.idle += dt;
    this.scale = damp(this.scale, this.scaleTarget, 6, dt);
    this.uniforms.uScatter.value = damp(this.uniforms.uScatter.value, this.scatterTarget, this.scatterTarget ? 7 : 3.2, dt);
    if (this.pending >= 0 && this.uniforms.uScatter.value > 0.97) {
      const i = this.pending;
      this.pending = -1;
      this._load(i);
      this.scatterTarget = 0;
      this.uniforms.uScatter.value = 1;
    }
    if (!this.holdVel) {
      this.rot.y += this.vel.y * dt;
      this.rot.x = clamp(this.rot.x + this.vel.x * dt, -1.4, 1.4);
      const k = Math.exp(-2.6 * dt);
      this.vel.x *= k; this.vel.y *= k;
      if (this.autoSpin && this.idle > 2.0 && Math.hypot(this.vel.x,this.vel.y) < 0.05) this.rot.y += 0.14 * dt;
    }
    const off = this.uniforms.uOff.value;
    for (let i = 0; i < MAXP; i++) {
      const grabbed = this.offT[i].lengthSq() > 1e-6;
      off[i].lerp(this.offT[i], 1 - Math.exp(-(grabbed ? 16 : 4) * dt));
    }
    this.uniforms.uTime.value = t;
    this.solidParts.update(this.uniforms.uOff.value, this.hover, this.sel);
    this.group.rotation.set(this.rot.x, this.rot.y, this.rot.z, 'YXZ');
    this.group.scale.setScalar(this.fit * this.scale);
    this.group.position.x = this.shift;
    this.group.updateMatrixWorld(true);
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }
}

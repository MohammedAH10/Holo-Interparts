# CAD → Interactive Hologram — Build Guide

> Build a hands-controlled, labelled, exploded-view 3D app **from scratch** where the models
> come from **CAD / 3D authoring tools** instead of hand-coded geometry.
> You import a design (STL / OBJ / GLTF / GLB / FBX / PLY), **compile** it into a labelled
> point-cloud "model pack", inspect every part with labels using gestures, and **add new
> parts to an existing design** — either at runtime in the app or at build time through a
> design manifest.

This guide is the engineering companion to `SYSTEM_ARCHITECTURE_AND_FLOWCHARTS.md`
(which holds the diagrams). Read that file for the pictures; read this one to type the code.

---

## Table of contents

1. [What you are building](#1-what-you-are-building)
2. [How it relates to HoloHand (reuse map)](#2-how-it-relates-to-holohand-reuse-map)
3. [Tech stack & prerequisites](#3-tech-stack--prerequisites)
4. [Project scaffold](#4-project-scaffold)
5. [Data formats (the important part)](#5-data-formats-the-important-part)
6. [The import layer](#6-the-import-layer)
7. [The compile layer](#7-the-compile-layer)
8. [The runtime layer](#8-the-runtime-layer)
9. [The labelling system](#9-the-labelling-system)
10. [Adding new parts](#10-adding-new-parts)
11. [The Node CLI compiler](#11-the-node-cli-compiler)
12. [Build it from scratch — step by step](#12-build-it-from-scratch--step-by-step)
13. [Run, build, deploy](#13-run-build-deploy)
14. [Extending further](#14-extending-further)
15. [Troubleshooting](#15-troubleshooting)
16. [File reference](#16-file-reference)

---

## 1. What you are building

A single-page web app. No backend is required for the core flow (browser-only, mesh
formats). It does four things:

1. **Import** an assembly from a CAD / 3D modelling tool.
2. **Compile** it: tessellate → sample the surfaces into a point cloud → resolve part
   names, labels, colours and explosion directions → write a compact **model pack**
   (`*.holo.json` + `*.holo.bin`).
3. **Interact**: render the pack as a glowing point cloud, explode/assemble it, rotate,
   zoom, point at a part to read its label + description, pinch to grab and drag it.
4. **Extend**: append new parts to a design, in-app at runtime or by editing a manifest
   and recompiling.

The renderer, gesture engine and hand tracking are essentially the same as HoloHand.
What is new is the **CAD import → compile pipeline** and the **label registry**.

---

## 2. How it relates to HoloHand (reuse map)

HoloHand is the reference implementation. This project keeps its strongest ideas and
replaces the model-authoring layer.

| HoloHand file | In this project | Why |
|---|---|---|
| `src/handTracking.js` | **Reuse unchanged** | MediaPipe `HandLandmarker` wrapper, 2 hands, local→CDN, GPU→CPU. |
| `src/gestureEngine.js` | **Reuse unchanged** | Landmarks → stable gesture, openness, palm/tip/pinch, wrist roll. |
| `src/utils.js` | **Reuse unchanged** | `clamp`, `damp`, `rng`, `angleDelta`. |
| `src/styles.css` | **Reuse, minor additions** | Add the compiler / add-part UI. |
| `src/scene.js` | **Keep, add two methods** | Same shader + explode + pick. Add `appendPart()` + `getPack()`. |
| `src/main.js` | **Adapt** | Same loop; models now come from packs; add import + add-part wiring. |
| `src/models/shapes.js` | **Delete** | CAD replaces procedural primitives. |
| `src/models/{jet,radial,car,brain}.js` | **Delete** | Replaced by imported designs. |
| `src/agent.js`, `src/objects/*` | **Delete** | Dead code in HoloHand; not used. |
| — | **New:** `src/import/*` | File loaders + assembly flattening + surface sampler. |
| — | **New:** `src/compile/*` | Compile manifest → model pack. |
| — | **New:** `src/labels/*` | CAD-id → human label/description registry. |
| — | **New:** `src/editing/*` | Runtime add-part + manifest validation. |
| — | **New:** `scripts/compile.mjs` | Build-time Node compiler. |

### The one invariant that makes this work

In HoloHand every model is an array of **parts**, and every part is a set of
**instances**, and every instance is a **point cloud** plus an **explode direction** and
an **anchor**:

```js
Part     = { name, desc, color, instances: Instance[] }
Instance = { cloud: { p: Float32Array, n }, dir: [x,y,z], anchor: [x,y,z] }
```

The whole renderer is written against that shape. **If the compiler produces this shape,
the renderer works unchanged.** That is the central design decision of this guide — the
compile step is nothing more than a converter from "CAD assembly" to "list of parts of
point clouds".

---

## 3. Tech stack & prerequisites

- **Node.js 18+** and **Chrome / Edge** (for camera + `HandLandmarker`).
- **Vite 5** — dev server and bundler.
- **three.js 0.170** — loaders, math, WebGL.
- **MediaPipe `@mediapipe/tasks-vision` 0.10.14** — hand tracking.

No server, no API keys, no uploads. Camera only works on `http://localhost` or HTTPS.

---

## 4. Project scaffold

```
holoforge/
├─ index.html
├─ compiler.html                 ← optional drag-and-drop compile page (browser path)
├─ package.json
├─ vite.config.js                ← optional dev endpoint to save packs to disk
├─ scripts/
│   ├─ setup.mjs                 ← copy MediaPipe wasm + download hand model
│   └─ compile.mjs               ← CLI: design manifest → model pack
├─ designs/
│   ├─ gearbox.design.json       ← authoring manifest
│   └─ labels.json               ← CAD-id → label/description overrides
├─ public/
│   ├─ wasm/                     ← MediaPipe runtime (generated by setup.mjs)
│   ├─ models/hand_landmarker.task
│   └─ packs/
│       ├─ index.json            ← { "packs": ["gearbox", ...] }
│       ├─ gearbox.holo.json
│       └─ gearbox.holo.bin
└─ src/
   ├─ main.js
   ├─ utils.js
   ├─ styles.css
   ├─ scene/
   │   ├─ HoloScene.js           ← scene.js from HoloHand + appendPart/getPack
   │   ├─ shaders.js             ← VERT / FRAG GLSL
   │   └─ packLoader.js          ← pack → renderer model
   ├─ import/
   │   ├─ loaders.js             ← STL/OBJ/GLTF/GLB/FBX/PLY → THREE.Object3D
   │   ├─ assembly.js            ← flatten + name + group meshes
   │   └─ sampler.js             ← triangle mesh → surface point cloud
   ├─ compile/
   │   ├─ compiler.js            ← assembly + manifest → { meta, binBuffer }
   │   ├─ colors.js              ← name → deterministic colour
   │   ├─ explode.js             ← anchor → explode direction
   │   └─ packWriter.js          ← download / save packs (browser)
   ├─ labels/
   │   └─ registry.js            ← CAD-id → { label, desc, color }
   ├─ editing/
   │   ├─ addPart.js             ← runtime: file → new part cloud
   │   └─ manifest.js            ← validate a design manifest
   └─ tracking/
       ├─ handTracking.js        ← from HoloHand (unchanged)
       └─ gestureEngine.js       ← from HoloHand (unchanged)
```

### `package.json`

```json
{
  "name": "holoforge",
  "private": true,
  "version": "1.0.0",
  "description": "CAD assemblies compiled to hand-controlled labelled exploded holograms",
  "type": "module",
  "scripts": {
    "dev": "vite --open",
    "build": "vite build",
    "preview": "vite preview",
    "compile": "node scripts/compile.mjs",
    "postinstall": "node scripts/setup.mjs"
  },
  "dependencies": {
    "@mediapipe/tasks-vision": "0.10.14",
    "three": "^0.170.0"
  },
  "devDependencies": {
    "vite": "^5.4.0"
  }
}
```

### `scripts/setup.mjs`

Identical to HoloHand: copy the MediaPipe WASM runtime into `public/wasm`, then download
the hand-landmarker model into `public/models` (falling back to a CDN at runtime if the
download is blocked). Copy it verbatim from `HoloHand/scripts/setup.mjs`.

### `vite.config.js` (optional dev endpoint)

Lets the browser compile page write packs straight into `public/packs/` during
development. In production you would drop packs in manually or use the CLI.

```js
import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

export default defineConfig({
  plugins: [
    {
      name: 'pack-save',
      configureServer(server) {
        server.middlewares.use('/api/save-pack', (req, res) => {
          const chunks = [];
          req.on('data', (c) => chunks.push(c));
          req.on('end', () => {
            try {
              const { name, json, binBase64 } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              const dir = path.resolve('public/packs');
              fs.mkdirSync(dir, { recursive: true });
              fs.writeFileSync(path.join(dir, `${name}.holo.json`), json);
              fs.writeFileSync(path.join(dir, `${name}.holo.bin`), Buffer.from(binBase64, 'base64'));
              res.end('ok');
            } catch (e) {
              res.statusCode = 500;
              res.end(String(e));
            }
          });
        });
      },
    },
  ],
});
```

---

## 5. Data formats (the important part)

There are **three** file formats. Get these right and everything else is mechanical.

### 5.1 Design manifest — `designs/<id>.design.json` (authoring)

You write this. It says *which file* to compile, *which meshes* become labelled parts, and
*how they explode*.

```json
{
  "id": "gearbox",
  "name": "Gearbox Assembly",
  "category": "Machines",
  "subtitle": "Six-speed gearbox with housing, gear train and shift forks",
  "view": { "x": 0.3, "y": -0.5, "z": 0 },
  "source": { "file": "assets/gearbox.glb" },
  "exclude": ["*_dummy", "*collision*"],
  "explodeMode": "radial",
  "explodeScale": 1.0,
  "parts": [
    { "mesh": "Housing*",  "color": "#46d9d0", "desc": "Outer casing that holds the gear train and the oil." },
    { "mesh": "Gear*",     "color": "#ffd23f", "explodeScale": 1.3 },
    { "mesh": "Shaft*",    "color": "#ffffff" },
    { "mesh": "Bearing*",  "color": "#ff6b9a" }
  ]
}
```

- `mesh` is a **glob** matched (case-insensitively) against the mesh/node name in the CAD
  file. `Housing*` catches `Housing`, `Housing_L`, `Housing.R`.
- `exclude` globs are removed before anything else (great for collision/hidden meshes).
- If `parts` is omitted, **every** mesh becomes a part.
- Any part whose name matches no rule still becomes a part, but with an auto colour and
  pretty-printed name.
- `explodeMode`: `"radial"` (outward from assembly centre) or `"axial"` (along +Y).
- `view` is the initial camera-space rotation in radians.

### 5.2 Model pack — `public/packs/<id>.holo.json` + `<id>.holo.bin` (compiled)

The **output** of the compiler and the **input** of the app. Never edit by hand.

```json
{
  "version": 1,
  "meta": {
    "id": "gearbox",
    "name": "Gearbox Assembly",
    "category": "Machines",
    "subtitle": "Six-speed gearbox with housing, gear train and shift forks",
    "view": { "x": 0.3, "y": -0.5, "z": 0 },
    "origin": [12.4, -3.1, 88.0],
    "radius": 142.7
  },
  "binName": "gearbox.holo.bin",
  "parts": [
    {
      "name": "Housing_L",
      "label": "Housing",
      "desc": "Outer casing that holds the gear train and the oil.",
      "color": "#46d9d0",
      "anchor": [1.2, 0.4, -18.0],
      "dir": [0.1, 0.03, -0.9],
      "byteOffset": 0,
      "byteLength": 96000,
      "count": 8000
    }
  ]
}
```

- `meta.origin` = the assembly centre that was subtracted from all points (kept so added
  parts can be aligned to the same space).
- `meta.radius` = assembly bounding-sphere radius (used to keep explosion spread
  consistent even for parts added later).
- `parts[i].byteOffset` / `byteLength` are byte ranges into the `.bin`.
- The `.bin` is a single `Float32Array` = every part's XYZ samples concatenated:
  `[x0,y0,z0, x1,y1,z1, ...]`.
- `index.json` lists the packs the app should load: `{ "packs": ["gearbox", "drone"] }`.

> **Why binary + JSON?** Positions are the only large data. Keeping them in a raw
> `Float32Array` means the loader is `new Float32Array(buffer, offset, count*3)` — zero
> parsing, zero copying — while metadata stays human-readable and diffable.

### 5.3 Label registry — `designs/labels.json`

Maps raw CAD ids to human labels, descriptions and colours. Applied **after** compile (in
the loader) so you can rename/label without recompiling. Keys may be exact names or
prefixed with `re:` for a regex.

```json
{
  "gearbox": {
    "Housing_L": { "label": "Left casing", "desc": "Splits the gearbox for servicing." },
    "Housing_R": { "label": "Right casing", "desc": "Holds the output shaft bearing." },
    "re:^Gear_[0-9]+$": { "label": "Gear", "color": "#ffd23f" }
  }
}
```

---

## 6. The import layer

### 6.1 `src/import/loaders.js` — file → `THREE.Object3D`

Uses three.js example loaders. Everything is parsed from an `ArrayBuffer` we already
have, so there are no surprise network requests.

```js
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const MESH_FORMATS = new Set(['stl', 'obj', 'glb', 'gltf', 'ply', 'fbx']);

export const extOf = (name) => name.split('.').pop().toLowerCase();
export const isSupported = (name) => MESH_FORMATS.has(extOf(name));

export async function loadModelFile(file) {
  const ext = extOf(file.name);
  if (!isSupported(file.name)) throw new Error(`Unsupported format: .${ext}`);

  const url = URL.createObjectURL(file);
  try {
    const buffer = await file.arrayBuffer();

    switch (ext) {
      case 'glb':
      case 'gltf': {
        const gltf = await new GLTFLoader().loadAsync(url);
        return gltf.scene;
      }
      case 'obj': {
        return new OBJLoader().parse(new TextDecoder().decode(buffer));
      }
      case 'stl': {
        const geo = new STLLoader().parse(buffer);
        geo.computeVertexNormals();
        return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ name: 'STL' }));
      }
      case 'ply': {
        const geo = new PLYLoader().parse(buffer);
        geo.computeVertexNormals();
        return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ name: 'PLY' }));
      }
      case 'fbx': {
        return new FBXLoader().parse(buffer, url);
      }
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}
```

### 6.2 `src/import/assembly.js` — flatten the scene graph

A CAD export is a **tree** of nodes, each with a world transform and possibly a material.
We walk it, apply world matrices, and **group meshes that belong to the same part name**
(so `Housing_L` and `Housing_R` with the same node name merge; distinct names become
distinct parts).

```js
import * as THREE from 'three';

/** "Part__Drive_Gear" → "Drive Gear" */
export function prettyName(raw) {
  const out = (raw || '')
    .replace(/^(part|solid|body|node|mesh|group|component)[_\-. ]*/i, '')
    .replace(/[_\-.]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  return out || 'Part';
}

/** glob → RegExp:  * → .*   ? → .   (everything else escaped). Case-insensitive. */
export function globToRegExp(glob) {
  const esc = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${esc}$`, 'i');
}

function materialColor(mat) {
  const m = Array.isArray(mat) ? mat[0] : mat;
  return m && m.color ? '#' + m.color.getHexString() : null;
}

/**
 * Walk a loaded Object3D and collect meshes grouped by part name.
 * Returns [{ name, color, meshes: [{ geometry, matrix }] }]
 */
export function flattenAssembly(root, { excludes = [] } = {}) {
  root.updateWorldMatrix(true, true);
  const groups = new Map();

  root.traverse((node) => {
    if (!node.isMesh || !node.geometry) return;
    if (!node.geometry.getAttribute('position')) return;

    const raw = node.name || node.material?.name || node.geometry.name || root.name || 'Part';
    const name = raw.trim() || 'Part';
    if (excludes.some((re) => re.test(name))) return;

    if (!groups.has(name)) {
      groups.set(name, { name, color: materialColor(node.material), meshes: [] });
    }
    groups.get(name).meshes.push({ geometry: node.geometry, matrix: node.matrixWorld.clone() });
  });

  return [...groups.values()];
}
```

> **Naming tip.** If your CAD export gives every mesh a useless name (e.g. `Object_1`),
> give the tool's parts proper names before export, or add `re:` rules in `labels.json`
> later. The compiler will still work — it just falls back to `Object_1`, `Object_2`, …

### 6.3 `src/import/sampler.js` — mesh → surface point cloud

This is the heart of the conversion. Given a triangle mesh, we sample points **weighted by
triangle area** so that large faces get proportionally more points. Uniform-on-the-surface
sampling looks better than sampling vertices, and it is independent of the source
tessellation.

```js
import * as THREE from 'three';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _ab = new THREE.Vector3(), _ac = new THREE.Vector3(), _p = new THREE.Vector3();

/** Read triangle `t` (indexed or non-indexed) into a, b, c. */
export function readTri(pos, index, t, a, b, c) {
  const i0 = index ? index.getX(t * 3) : t * 3;
  const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
  const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
  a.fromBufferAttribute(pos, i0);
  b.fromBufferAttribute(pos, i1);
  c.fromBufferAttribute(pos, i2);
}

/** Total surface area of a mesh. */
export function meshArea(geometry) {
  const pos = geometry.getAttribute('position');
  if (!pos) return 0;
  const index = geometry.index;
  const tris = index ? index.count / 3 : pos.count / 3;
  let area = 0;
  for (let t = 0; t < tris; t++) {
    readTri(pos, index, t, _a, _b, _c);
    _ab.subVectors(_b, _a);
    _ac.subVectors(_c, _a);
    area += _ab.cross(_ac).length() * 0.5;
  }
  return area;
}

/**
 * Area-weighted random surface sample of one mesh, transformed to world space.
 * Returns a flat Float32Array of xyz triples.
 */
export function sampleMesh(geometry, matrix, targetPoints) {
  const pos = geometry.getAttribute('position');
  if (!pos) return new Float32Array(0);
  const index = geometry.index;
  const tris = index ? index.count / 3 : pos.count / 3;
  if (tris <= 0) return new Float32Array(0);

  // Cumulative distribution over triangle areas.
  const cdf = new Float32Array(tris);
  let total = 0;
  for (let t = 0; t < tris; t++) {
    readTri(pos, index, t, _a, _b, _c);
    _ab.subVectors(_b, _a);
    _ac.subVectors(_c, _a);
    total += _ab.cross(_ac).length() * 0.5;
    cdf[t] = total;
  }
  if (total <= 0) return new Float32Array(0);

  const out = new Float32Array(targetPoints * 3);
  let w = 0;
  for (let i = 0; i < targetPoints; i++) {
    // Binary search a random area into the CDF.
    const r = Math.random() * total;
    let lo = 0, hi = tris - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    readTri(pos, index, lo, _a, _b, _c);

    // Uniform point inside the triangle (reflect out-of-range barycentrics).
    let u = Math.random(), v = Math.random();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    _ab.subVectors(_b, _a);
    _ac.subVectors(_c, _a);
    _p.copy(_a).addScaledVector(_ab, u).addScaledVector(_ac, v).applyMatrix4(matrix);

    out[w++] = _p.x; out[w++] = _p.y; out[w++] = _p.z;
  }
  return out;
}

export function centroid(points) {
  const n = points.length / 3 || 1;
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < points.length; i += 3) { x += points[i]; y += points[i + 1]; z += points[i + 2]; }
  return [x / n, y / n, z / n];
}

/** Concatenate chunks, subtracting a common centre (recentre the assembly). */
export function recenterChunks(chunks, cx, cy, cz) {
  let n = 0;
  for (const c of chunks) n += c.length;
  const out = new Float32Array(n);
  let w = 0;
  for (const c of chunks) {
    for (let i = 0; i < c.length; i += 3) {
      out[w++] = c[i] - cx;
      out[w++] = c[i + 1] - cy;
      out[w++] = c[i + 2] - cz;
    }
  }
  return out;
}

export function concatFloat32(chunks) {
  let n = 0;
  for (const c of chunks) n += c.length;
  const out = new Float32Array(n);
  let w = 0;
  for (const c of chunks) { out.set(c, w); w += c.length; }
  return out;
}

/** World-space bounding box of all groups. */
export function groupBounds(groups) {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const g of groups) {
    for (const m of g.meshes) {
      const pos = m.geometry.getAttribute('position');
      if (!pos) continue;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrix);
        box.expandByPoint(v);
      }
    }
  }
  return box;
}
```

---

## 7. The compile layer

### 7.1 `src/compile/colors.js` — deterministic colour from a name

So parts without a material/explicit colour still get a stable, distinct hue.

```js
import * as THREE from 'three';

export function colorForName(name) {
  let h = 2166136261; // FNV-1a
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hue = ((h >>> 0) % 360) / 360;
  return '#' + new THREE.Color().setHSL(hue, 0.62, 0.66).getHexString();
}
```

### 7.2 `src/compile/explode.js` — anchor → explode direction

Radial (away from the assembly centre) is the best default: it looks like an exploded
diagram for almost any mechanical assembly. `axial` pushes everything along +Y.

```js
/**
 * @param anchor  part centroid in recentered assembly space [x,y,z]
 * @param radius  assembly bounding-sphere radius
 * @param mode    'radial' | 'axial'
 * @param scale   multiplier (per-part override allowed)
 */
export function deriveExplode(anchor, radius, { mode = 'radial', scale = 1 } = {}) {
  let [dx, dy, dz] = anchor;
  let len = Math.hypot(dx, dy, dz);
  if (mode !== 'radial' || len < 1e-4) { dx = 0; dy = 1; dz = 0; len = 1; }
  const k = Math.max(0.4, radius) * 0.6 * scale;
  return { anchor, dir: [(dx / len) * k, (dy / len) * k, (dz / len) * k] };
}
```

> The magnitude `k` is a fraction of the assembly radius, so the explosion spread looks
> the same whether the source is in millimetres or metres. The runtime then rescales the
> whole model to fit the view, so `dir` and geometry stay in proportion automatically.

### 7.3 `src/compile/compiler.js` — assembly + manifest → model pack

```js
import * as THREE from 'three';
import { flattenAssembly, globToRegExp, prettyName } from '../import/assembly.js';
import {
  sampleMesh, meshArea, recenterChunks, concatFloat32, centroid, groupBounds,
} from '../import/sampler.js';
import { colorForName } from './colors.js';
import { deriveExplode } from './explode.js';

export const MAXP = 24; // must match the shader uniform array size in shaders.js

/**
 * Compile a loaded Object3D + manifest into a model pack.
 * @returns { meta, binBuffer }  (binBuffer is a Float32Array)
 */
export function compileDesign(root, manifest, registry = null, opts = {}) {
  const pointsPerUnit = opts.pointsPerUnit ?? 0.006; // points per squared source unit
  const maxPoints = opts.maxPoints ?? 60000;         // global point budget

  const excludes = (manifest.exclude || []).map(globToRegExp);
  const rules = (manifest.parts || []).map((r) => ({
    ...r,
    re: r.mesh ? globToRegExp(r.mesh) : null,
  }));

  let groups = flattenAssembly(root, { excludes });

  // If the manifest lists parts, keep only meshes claimed by a rule.
  if (rules.length) {
    groups = groups.filter((g) => rules.some((r) => !r.re || r.re.test(g.name)));
  }
  if (!groups.length) {
    throw new Error('No meshes matched. Check manifest.parts / exclude globs / mesh names.');
  }

  // Assembly bounds → centre + radius.
  const bounds = groupBounds(groups);
  const center = bounds.getCenter(new THREE.Vector3());
  const radius = bounds.getBoundingSphere(new THREE.Sphere()).radius || 1;

  // Measure areas, then scale the point budget so total <= maxPoints.
  let totalArea = 0;
  for (const g of groups) {
    g.area = g.meshes.reduce((s, m) => s + meshArea(m.geometry), 0);
    totalArea += g.area;
  }
  const scale = Math.min(1, maxPoints / Math.max(1, totalArea * pointsPerUnit));

  const parts = [];
  const chunks = [];

  for (const g of groups) {
    const rule = rules.find((r) => r.re && r.re.test(g.name)) || {};
    const budget = Math.max(
      48,
      Math.round(g.area * pointsPerUnit * scale * (rule.density ?? 1)),
    );

    // Sample each mesh, splitting the part budget by surface area.
    const local = [];
    for (const m of g.meshes) {
      const share = g.area > 0
        ? Math.max(1, Math.round(budget * (meshArea(m.geometry) / g.area)))
        : budget;
      local.push(sampleMesh(m.geometry, m.matrix, share));
    }
    const cloud = recenterChunks(local, center.x, center.y, center.z);
    if (!cloud.length) continue;

    const info = (registry && registry.resolve(manifest.id, g.name)) || {};
    const cn = centroid(cloud);
    const { dir } = deriveExplode(cn, radius, {
      mode: rule.explodeMode || manifest.explodeMode || 'radial',
      scale: rule.explodeScale ?? manifest.explodeScale ?? 1,
    });

    chunks.push(cloud);
    parts.push({
      name: g.name,
      label: info.label || prettyName(g.name),
      desc: info.desc || rule.desc || '',
      color: rule.color || info.color || g.color || colorForName(g.name),
      anchor: cn,
      dir,
      byteOffset: 0,          // filled below
      byteLength: cloud.byteLength,
      count: cloud.length / 3,
    });
  }

  if (parts.length > MAXP) {
    throw new Error(
      `Too many parts: ${parts.length} (max ${MAXP}). ` +
      `Merge meshes with manifest.parts, or raise MAXP in shaders.js.`,
    );
  }

  // Assign binary offsets.
  let byteOffset = 0;
  for (const p of parts) { p.byteOffset = byteOffset; byteOffset += p.byteLength; }

  const meta = {
    version: 1,
    meta: {
      id: manifest.id,
      name: manifest.name,
      category: manifest.category || 'Imported',
      subtitle: manifest.subtitle || '',
      view: manifest.view || { x: 0.25, y: -0.5, z: 0 },
      origin: [center.x, center.y, center.z],
      radius,
    },
    binName: `${manifest.id}.holo.bin`,
    parts,
  };

  return { meta, binBuffer: concatFloat32(chunks) };
}
```

### 7.4 `src/compile/packWriter.js` — save the pack (browser)

```js
function triggerDownload(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export function downloadPack(meta, binBuffer) {
  triggerDownload(
    new Blob([JSON.stringify(meta, null, 2)], { type: 'application/json' }),
    `${meta.meta.id}.holo.json`,
  );
  triggerDownload(
    new Blob([binBuffer], { type: 'application/octet-stream' }),
    meta.binName,
  );
}

/** Optional: push the pack to the dev server (see vite.config.js). */
export async function savePackToDevServer(meta, binBuffer) {
  const binBase64 = arrayBufferToBase64(binBuffer.buffer);
  await fetch('/api/save-pack', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: meta.meta.id, json: JSON.stringify(meta, null, 2), binBase64 }),
  });
}

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}
```

---

## 8. The runtime layer

### 8.1 `src/scene/packLoader.js` — pack → renderer model

This is the bridge that turns a compiled pack into exactly the `Part[]` shape the
renderer expects.

```js
export async function loadPack(url) {
  const meta = await (await fetch(url)).json();
  const binUrl = new URL(meta.binName, new URL(url, location.href)).href;
  const buffer = await (await fetch(binUrl)).arrayBuffer();
  const views = meta.parts.map((p) => new Float32Array(buffer, p.byteOffset, p.count * 3));
  return { meta, views, buffer };
}

/** Build the renderer-facing model object (same contract HoloHand's models used). */
export function packToModel(pack, registry = null) {
  const { meta, views } = pack;

  const parts = meta.parts.map((p, i) => {
    const info = (registry && registry.resolve(meta.meta.id, p.name)) || {};
    const cloud = { p: views[i], get n() { return this.p.length / 3; } };
    return {
      name: info.label || p.label || p.name,
      raw: p.name,
      desc: info.desc || p.desc || '',
      color: info.color || p.color,
      instances: [{ cloud, dir: p.dir, anchor: p.anchor }],
    };
  });

  // build() is memoized so runtime appendPart can mutate the same array.
  const built = parts;
  return {
    id: meta.meta.id,
    name: meta.meta.name,
    category: meta.meta.category,
    subtitle: meta.meta.subtitle,
    view: meta.meta.view,
    radius: meta.meta.radius,
    origin: meta.meta.origin,
    build: () => built,
    _pack: pack,
  };
}

export async function loadAllPacks(indexUrl, registry = null) {
  const idx = await (await fetch(indexUrl)).json();
  const base = indexUrl.replace(/[^/]*$/, '');
  const models = [];
  for (const id of idx.packs) {
    const pack = await loadPack(`${base}${id}.holo.json`);
    models.push(packToModel(pack, registry));
  }
  return models;
}
```

### 8.2 `src/scene/HoloScene.js` — the renderer, plus two methods

Copy HoloHand's `src/scene.js` and split out the GLSL into `src/scene/shaders.js`
(verbatim). Everything works as before. Add these two methods for runtime part adding:

```js
  /** Expose the current pack so editing tools can read origin/radius. */
  getPack() {
    return this.models[this.index]?._pack || null;
  }

  /**
   * Append a new part (cloud + metadata) to the current model and rebuild geometry.
   * `part` = { name, label, desc, color, dir, anchor }
   */
  appendPart(part, cloudArray) {
    const model = this.models[this.index];
    const built = model.build(); // the memoized parts array from packToModel

    if (built.length >= MAXP) {
      throw new Error(`Max ${MAXP} parts reached for this model.`);
    }

    built.push({
      name: part.label || part.name,
      raw: part.name,
      desc: part.desc || '',
      color: part.color,
      instances: [{
        cloud: { p: cloudArray, get n() { return this.p.length / 3; } },
        dir: part.dir,
        anchor: part.anchor,
      }],
    });

    // Rebuild this model's geometry from the updated parts list.
    this.cache.delete(this.index);
    const g = this._geometry(this.index);
    this.points.geometry.dispose();
    this.points.geometry = g.geo;
    this.parts = g.meta;
    this.fit = g.fit;
    this.count = g.count;
    this.releaseAll(true);
    if (this.onModel) this.onModel(this.index, model, g);
  }
```

> Nothing else in the shader or interaction code changes. Adding a part just grows
> `built`, regenerates the single `BufferGeometry`, and swaps it onto the existing
> `THREE.Points`. Because the shader's `uOff` array is a fixed 24 slots and `aPart` is a
> float attribute, appending within 24 parts needs no shader edits.

### 8.3 `src/main.js` — wiring it together

Same structure as HoloHand's `main.js`. Only the model-source and two new UI hooks change.

```js
import './styles.css';
import { HoloScene } from './scene/HoloScene.js';
import { loadAllPacks } from './scene/packLoader.js';
import { HandTracker } from './tracking/handTracking.js';
import { GestureEngine, HAND_CONNECTIONS } from './tracking/gestureEngine.js';
import { createRegistry } from './labels/registry.js';
import { addPartFromFile } from './editing/addPart.js';
import { clamp } from './utils.js';

const $ = (id) => document.getElementById(id);

// 1) Load labels, then packs, then build the scene.
const registry = createRegistry();
await fetch('/packs/labels.json').then((r) => (r.ok ? r.json() : {})).then((o) => Object.assign(registry.models, o)).catch(() => {});

const MODELS = await loadAllPacks('/packs/index.json', registry);
if (!MODELS.length) {
  document.body.innerHTML = '<p style="padding:2rem">No packs found. Compile one into public/packs/.</p>';
  throw new Error('no packs');
}

const scene = new HoloScene($('scene'), MODELS);
const tracker = new HandTracker();
const engine = new GestureEngine();

// ... (chip builder, onModel, gesture→action control(), overlay drawing, mouse/keyboard
//      are identical to HoloHand's main.js — reuse them verbatim) ...

// 2) Add-part at runtime.
const partInput = Object.assign(document.createElement('input'), {
  type: 'file',
  accept: '.stl,.obj,.ply,.glb,.gltf,.fbx',
});
$('b-add').onclick = () => partInput.click();
partInput.onchange = async () => {
  const file = partInput.files?.[0];
  partInput.value = '';
  if (!file) return;
  try {
    toast(`Importing ${file.name}…`);
    const { part, cloud } = await addPartFromFile(file, scene.getPack(), { align: true });
    scene.appendPart(part, cloud);
    toast(`Added ${part.label}`);
  } catch (e) {
    console.error(e);
    toast('Could not add part (see console)');
  }
};
```

Add one button to `index.html` (inside `.btns` or the toolbar):

```html
<button id="b-add" title="Add a part from a file">Add part</button>
```

That is the entire runtime side.

---

## 9. The labelling system

### 9.1 `src/labels/registry.js`

```js
export function createRegistry(initial = {}) {
  const reg = {
    models: initial,

    /** exact match first, then `re:` regex keys in insertion order */
    resolve(modelId, rawName) {
      const m = reg.models[modelId];
      if (!m) return null;
      if (m[rawName]) return m[rawName];
      for (const [k, v] of Object.entries(m)) {
        if (k.startsWith('re:') && new RegExp(k.slice(3), 'i').test(rawName)) return v;
      }
      return null;
    },

    set(modelId, rawName, info) {
      reg.models[modelId] ||= {};
      reg.models[modelId][rawName] = { ...(reg.models[modelId][rawName] || {}), ...info };
    },

    remove(modelId, rawName) {
      delete reg.models[modelId]?.[rawName];
    },

    export() {
      return JSON.stringify(reg.models, null, 2);
    },
  };
  return reg;
}
```

### 9.2 How a label is resolved (precedence)

For each part, in order:

1. **`labels.json` exact match** on the raw CAD name.
2. **`labels.json` regex match** (`re:` keys).
3. The `label` stored in the pack at compile time (which itself came from the manifest
   `desc`/`color`, or the pretty name).
4. **Fallback:** `prettyName(rawName)` — e.g. `Part__Drive_Gear` → `Drive Gear`.

Because the registry is applied **in the loader**, you can fix names and write
descriptions without recompiling — ideal for iterating on documentation.

### 9.3 Descriptions

Descriptions come from the manifest `desc` fields and then get overridden by
`labels.json`. Ship a `labels.json` next to your packs so the shipped app shows the text
you wrote; users can download/edit/import it as JSON.

---

## 10. Adding new parts

Two workflows, both required by the brief.

### 10.1 Runtime (in-app)

`src/editing/addPart.js` turns a picked file into a new part cloud. `align: true`
subtracts the existing pack's `origin` so the new part lands in the same coordinate space
as the rest of the assembly; `align: false` centres the new file on the assembly origin.

```js
import * as THREE from 'three';
import { loadModelFile } from '../import/loaders.js';
import { flattenAssembly, prettyName } from '../import/assembly.js';
import { sampleMesh, meshArea, groupBounds, centroid, recenterChunks } from '../import/sampler.js';
import { deriveExplode } from '../compile/explode.js';
import { colorForName } from '../compile/colors.js';

export async function addPartFromFile(file, pack, opts = {}) {
  const pointsPerUnit = opts.pointsPerUnit ?? 0.006;

  const root = await loadModelFile(file);
  const groups = flattenAssembly(root);
  if (!groups.length) throw new Error('No meshes found in the file.');

  // Which centre to subtract: the existing assembly origin, or this file's own centre.
  const bounds = groupBounds(groups);
  const fileCenter = bounds.getCenter(new THREE.Vector3());
  const meta = pack?.meta?.meta || {};
  const subtract = opts.align && meta.origin ? meta.origin : [fileCenter.x, fileCenter.y, fileCenter.z];

  // Sample all meshes into one cloud.
  let area = 0;
  for (const g of groups) for (const m of g.meshes) area += meshArea(m.geometry);

  const chunks = [];
  for (const g of groups) {
    for (const m of g.meshes) {
      const share = Math.max(1, Math.round(area * pointsPerUnit * (meshArea(m.geometry) / area)));
      chunks.push(sampleMesh(m.geometry, m.matrix, share));
    }
  }
  const cloud = recenterChunks(chunks, subtract[0], subtract[1], subtract[2]);
  if (!cloud.length) throw new Error('Sampling produced no points.');

  const cn = centroid(cloud);
  const { dir } = deriveExplode(cn, meta.radius || 1, {
    mode: opts.explodeMode || 'radial',
    scale: opts.explodeScale ?? 1,
  });

  const base = file.name.replace(/\.[^.]+$/, '');
  const part = {
    name: base,
    label: opts.label || prettyName(base),
    desc: opts.desc || 'Part added at runtime.',
    color: opts.color || colorForName(base),
    anchor: cn,
    dir,
    count: cloud.length / 3,
  };
  return { part, cloud };
}
```

**Making it stick.** Runtime additions live in memory. To persist them, after
`appendPart` re-serialize the current model and download it, or POST it to the dev
endpoint:

```js
// Re-serialize the whole current model (existing + added parts) into a fresh pack.
import { concatFloat32 } from '../import/sampler.js';

function serializeCurrentModel(model) {
  const parts = model.build();
  const chunks = [];
  const out = [];
  let byteOffset = 0;
  for (const p of parts) {
    const cloud = p.instances[0].cloud.p;
    chunks.push(cloud);
    out.push({
      name: p.raw || p.name,
      label: p.name,
      desc: p.desc,
      color: p.color,
      anchor: p.instances[0].anchor,
      dir: p.instances[0].dir,
      byteOffset,
      byteLength: cloud.byteLength,
      count: cloud.length / 3,
    });
    byteOffset += cloud.byteLength;
  }
  const meta = { ...model._pack.meta, parts: out };
  return { meta, binBuffer: concatFloat32(chunks) };
}
// → downloadPack(meta, binBuffer)  or  savePackToDevServer(meta, binBuffer)
```

### 10.2 Build-time (manifest authoring)

1. Add a rule to `designs/<id>.design.json`:
   ```json
   { "mesh": "NewBracket*", "color": "#4fe3e0", "desc": "Mounting bracket." }
   ```
   or add a whole new source file:
   ```json
   { "mesh": "Pump", "source": "assets/pump.stl", "color": "#ff9f2e" }
   ```
2. Recompile:
   ```bash
   npm run compile -- designs/gearbox.design.json
   ```
3. Reload the app. The new part is present, labelled, and explodes with the rest.

### 10.3 Adding a second, separate design

Drop a new manifest, compile it, and add its id to `public/packs/index.json`
(the CLI regenerates `index.json` for you). It then appears as another model you can
cycle to with the gesture / arrow keys / chips — exactly like HoloHand's four built-ins.

---

## 11. The Node CLI compiler

Use this for build-time compilation so packs are reproducible and versioned. It reads a
manifest, loads the source, compiles, writes `*.holo.json` + `*.holo.bin`, and refreshes
`index.json`.

`scripts/compile.mjs`:

```js
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { compileDesign } from '../src/compile/compiler.js';
import { createRegistry } from '../src/labels/registry.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestArg = process.argv[2];
if (!manifestArg) {
  console.error('Usage: node scripts/compile.mjs designs/<id>.design.json');
  process.exit(1);
}

const manifest = JSON.parse(await fs.readFile(path.resolve(root, manifestArg), 'utf8'));
const srcPath = path.resolve(root, manifest.source.file);
const fileBuf = await fs.readFile(srcPath);
const ab = fileBuf.buffer.slice(fileBuf.byteOffset, fileBuf.byteOffset + fileBuf.byteLength);
const ext = path.extname(srcPath).slice(1).toLowerCase();

let rootObj;
if (ext === 'stl') {
  const g = new STLLoader().parse(ab); g.computeVertexNormals();
  rootObj = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ name: manifest.name }));
} else if (ext === 'obj') {
  rootObj = new OBJLoader().parse(fileBuf.toString('utf8'));
} else if (ext === 'ply') {
  const g = new PLYLoader().parse(ab); g.computeVertexNormals();
  rootObj = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ name: manifest.name }));
} else if (ext === 'glb' || ext === 'gltf') {
  rootObj = await new Promise((res, rej) =>
    new GLTFLoader().parse(ab, '', (g) => res(g.scene), rej));
} else {
  throw new Error(`Unsupported CLI format: .${ext} (use the browser compiler)`);
}

const registry = createRegistry();
try {
  const labels = JSON.parse(await fs.readFile(path.join(root, 'designs/labels.json'), 'utf8'));
  Object.assign(registry.models, labels);
} catch { /* labels.json is optional */ }

const { meta, binBuffer } = compileDesign(rootObj, manifest, registry);

const outDir = path.join(root, 'public/packs');
await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(path.join(outDir, `${manifest.id}.holo.json`), JSON.stringify(meta, null, 2));
await fs.writeFile(path.join(outDir, meta.binName), Buffer.from(binBuffer.buffer));

// Refresh index.json with every compiled pack.
const ids = (await fs.readdir(outDir))
  .filter((f) => f.endsWith('.holo.json'))
  .map((f) => f.replace('.holo.json', ''));
await fs.writeFile(
  path.join(outDir, 'index.json'),
  JSON.stringify({ packs: ids }, null, 2),
);

console.log(`Compiled "${manifest.id}": ${meta.parts.length} parts, ${meta.parts.reduce((s, p) => s + p.count, 0)} points`);
```

> **CLI format support:** STL, OBJ, PLY and GLB/GLTF work in Node. FBX and
> GLTF-with-external-textures should go through the **browser compiler** (see below),
> which has the full loader environment.

### Browser compiler page (optional)

Add `compiler.html` + `src/compile/compilerPage.js` that:
1. lets you drop a mesh file,
2. loads it with `src/import/loaders.js` (full format support, including FBX),
3. compiles it with `compileDesign`,
4. calls `savePackToDevServer` (dev) or `downloadPack` (prod).

```js
// src/compile/compilerPage.js (sketch)
import { loadModelFile } from '../import/loaders.js';
import { compileDesign } from './compiler.js';
import { savePackToDevServer, downloadPack } from './packWriter.js';
import { createRegistry } from '../labels/registry.js';

const registry = createRegistry();
fetch('/packs/labels.json').then((r) => r.json()).then((o) => Object.assign(registry.models, o)).catch(() => {});

export async function compileFile(file, manifest) {
  const root = await loadModelFile(file);
  const { meta, binBuffer } = compileDesign(root, manifest, registry);
  try { await savePackToDevServer(meta, binBuffer); }
  catch { downloadPack(meta, binBuffer); }
  return meta;
}
```

---

## 12. Build it from scratch — step by step

Follow this once and you will have a working app.

1. **Scaffold.** Create the folder tree from §4. Copy `setup.mjs`, `packages.json`,
   `vite.config.js`.
2. **Install.** `npm install` (runs `setup.mjs`, populating `public/wasm` and
   `public/models` — or falls back to CDN).
3. **Port the tracking + gestures.** Copy `handTracking.js` and `gestureEngine.js` from
   HoloHand into `src/tracking/` unchanged. Copy `utils.js`.
4. **Port the renderer.** Copy `scene.js` → `src/scene/HoloScene.js`, move `VERT`/`FRAG`
   into `src/scene/shaders.js`, import `MAXP` from the compiler (or keep the literal but
   keep them equal).
5. **Write the import layer.** Add `import/loaders.js`, `import/assembly.js`,
   `import/sampler.js` (§6).
6. **Write the compile layer.** Add `compile/colors.js`, `compile/explode.js`,
   `compile/compiler.js`, `compile/packWriter.js` (§7).
7. **Write the runtime bridge.** Add `scene/packLoader.js` (§8.1), then add
   `getPack()` / `appendPart()` to `HoloScene` (§8.2).
8. **Write the label registry.** Add `labels/registry.js` (§9).
9. **Write the editing layer.** Add `editing/addPart.js`, `editing/manifest.js` (§10).
10. **Write the CLI.** Add `scripts/compile.mjs` (§11).
11. **Author a design.** Create `designs/gearbox.design.json`, put `assets/gearbox.glb`
    next to it, and run `npm run compile -- designs/gearbox.design.json`.
12. **Write `public/packs/index.json`** (the CLI writes it when it compiles).
13. **Adapt `main.js`** to load packs and wire the "Add part" button (§8.3). Reuse
    HoloHand's chip builder, model callback, gesture→action `control()`, overlay drawing,
    and mouse/keyboard fallbacks verbatim.
14. **Adjust `index.html`** — add the `#b-add` button; keep the rest of the shell.
15. **Run.** `npm run dev`, click *Start camera*, and use the gestures.

### `src/editing/manifest.js`

Small validator so bad manifests fail loudly with useful messages.

```js
export function validateManifest(m) {
  const errs = [];
  if (!m || typeof m !== 'object') return ['manifest must be an object'];
  if (!m.id) errs.push('missing "id"');
  if (!m.name) errs.push('missing "name"');
  if (!m.source?.file) errs.push('missing "source.file"');
  if (m.parts && !Array.isArray(m.parts)) errs.push('"parts" must be an array');
  for (const [i, p] of (m.parts || []).entries()) {
    if (p.mesh && typeof p.mesh !== 'string') errs.push(`parts[${i}].mesh must be a string`);
  }
  return errs;
}
```

---

## 13. Run, build, deploy

```bash
npm install
npm run compile -- designs/gearbox.design.json   # produces public/packs/*
npm run dev                                       # http://localhost:5173
npm run build                                     # static site in dist/
npm run preview
```

Camera works only on `http://localhost` or HTTPS. Deploy `dist/` to any static host.
Packs are plain static files under `/packs/` — no server logic required. If the
MediaPipe model could not be downloaded at install time, the app fetches it from a CDN
at runtime.

---

## 14. Extending further

- **STEP / IGES.** Parametric CAD is not a mesh. Add a conversion step: use
  `occt-import-js` / `opencascade.js` (WASM) in the browser, or a Node/Python service
  (`pythonocc`, `CadQuery`, Assimp) that tessellates STEP → glTF and hands it to this
  same compile pipeline. Only the import layer changes.
- **Assembly-tree colours/materials.** `flattenAssembly` already reads material colours;
  extend it to read per-node `userData` annotations from glTF (e.g. `partNumber`,
  `material`, `mass`) and write them into the pack's `desc`.
- **Level of detail.** Compile two packs per design (`-lod0`, `-lod1`) with different
  point budgets, and pick based on device.
- **Highlight-specific shader effects.** Parts already carry an index; add per-part
  emissive pulse so a searched part strobes.
- **Search / BOM panel.** Use the pack's part list to build a bill-of-materials sidebar;
  clicking a row selects and explodes toward that part.
- **Measurements.** Store a `source.unitScale` and show real dimensions when hovering a
  part anchor.

---

## 15. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "No meshes matched" | manifest globs don't match node names | Inspect names; widen globs; check `exclude`. |
| "Too many parts (N > 24)" | too many distinct parts | Merge via manifest, or raise `MAXP` **and** the `uOff[24]` shader array. |
| Explosion looks weak / huge | `radius` scale off | Tune `explodeScale`; ensure one compile used consistent units. |
| Parts explode to the wrong side | radial around origin | Set `explodeMode: "axial"`, or per-part `explodeDir` override. |
| Colours all grey | CAD material was white/none | Set explicit `color` in manifest or `labels.json`. |
| GLB/FBX fails in CLI | loader needs a DOM | Use the browser compiler page. |
| Added part in the wrong place | coordinate space mismatch | Use `align: true` so it subtracts the pack `origin`. |
| Labels show `Object_1` | unnamed CAD meshes | Name parts before export, or map with `re:` rules in `labels.json`. |
| Points too sparse/dense | density | Change `pointsPerUnit`, `maxPoints`, or per-part `density`. |

---

## 16. File reference

| File | Responsibility |
|---|---|
| `src/import/loaders.js` | Mesh file → `THREE.Object3D` (6 formats). |
| `src/import/assembly.js` | Flatten scene graph, group meshes by part name, glob matching. |
| `src/import/sampler.js` | Triangle mesh → area-weighted surface point cloud. |
| `src/compile/compiler.js` | Assembly + manifest + labels → `{ meta, binBuffer }`. |
| `src/compile/colors.js` | Deterministic name → colour. |
| `src/compile/explode.js` | Anchor + radius → explode direction. |
| `src/compile/packWriter.js` | Download / save packs (browser). |
| `src/scene/packLoader.js` | Pack → renderer model; load all packs. |
| `src/scene/HoloScene.js` | Point-cloud renderer + `appendPart` / `getPack`. |
| `src/scene/shaders.js` | Vertex/fragment GLSL, `uOff[24]`. |
| `src/labels/registry.js` | CAD-id → label/description/colour, exact + regex. |
| `src/editing/addPart.js` | Runtime file → new part cloud. |
| `src/editing/manifest.js` | Manifest validation. |
| `src/tracking/handTracking.js` | MediaPipe HandLandmarker (from HoloHand). |
| `src/tracking/gestureEngine.js` | Landmarks → gesture (from HoloHand). |
| `scripts/compile.mjs` | CLI: manifest → pack files + `index.json`. |
| `scripts/setup.mjs` | MediaPipe WASM + hand model (from HoloHand). |
| `designs/*.design.json` | Authoring manifests. |
| `designs/labels.json` | Label/description overrides. |
| `public/packs/*` | Compiled model packs + index. |

For the **diagrams** of every flow (compile pipeline, runtime loop, gesture state
machine, add-part flow, data model), see
[`SYSTEM_ARCHITECTURE_AND_FLOWCHARTS.md`](./SYSTEM_ARCHITECTURE_AND_FLOWCHARTS.md).

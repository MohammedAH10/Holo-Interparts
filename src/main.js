import './styles.css';
import { HoloScene } from './scene.js';
import { MODELS, DEMO_MODELS } from './models/index.js';
import { HandTracker } from './handTracking.js';
import { GestureEngine, HAND_CONNECTIONS } from './gestureEngine.js';
import { clamp } from './utils.js';
import { addPartFromFile } from './editing/addPart.js';
import { loadModelFile } from './import/loaders.js';
import { flattenAssembly } from './import/assembly.js';
import { sampleMesh, meshArea, groupBounds, centroid, recenterChunks } from './import/sampler.ext.js';
import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const video = $('video');
const fxCanvas = $('fx');
const ctx = fxCanvas.getContext('2d');
const banner = $('banner');

let W = innerWidth, H = innerHeight, DPR = 1;
function sizeFx() {
  W = innerWidth; H = innerHeight;
  DPR = Math.min(devicePixelRatio || 1, 2);
  fxCanvas.width = W * DPR; fxCanvas.height = H * DPR;
}
sizeFx();
addEventListener('resize', sizeFx);

function showBanner(msg, info = false) {
  banner.textContent = msg;
  banner.className = info ? 'info' : '';
  banner.style.display = msg ? 'block' : 'none';
}
let toastTimer = 0;
function toast(msg) {
  const el = $('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
}

let scene;
try {
  scene = new HoloScene($('scene'), MODELS);
} catch (e) {
  console.error(e);
  showBanner('WebGL is not available. Use a current Chrome, Edge or Firefox with hardware acceleration on.');
  throw e;
}

const ui = { skeleton: true, labels: true, feed: false };
let trackingState = 'Off';

const chips = $('chips');
if (chips && MODELS.length > 0) {
  for (const cat of [...new Set(MODELS.map((m) => m.category || 'General'))]) {
    const grp = document.createElement('div');
    grp.className = 'grp';
    const gl = document.createElement('span');
    gl.className = 'gl';
    gl.textContent = cat;
    grp.appendChild(gl);
    MODELS.forEach((m, i) => {
      if ((m.category || 'General') !== cat) return;
      const b = document.createElement('button');
      b.textContent = m.name || `Model ${i}`;
      b.dataset.i = i;
      b.onclick = () => scene.setModel(i);
      grp.appendChild(b);
    });
    chips.appendChild(grp);
  }
}

const demoList = $('demo-list');
function renderDemos() {
  if (!demoList) return;
  demoList.innerHTML = '';
  if (!DEMO_MODELS.length) {
    const em = document.createElement('p');
    em.className = 'demo-empty';
    em.textContent = 'No built-in demo designs bundled.';
    demoList.appendChild(em);
    return;
  }
  DEMO_MODELS.forEach((m) => {
    const i = MODELS.indexOf(m);
    const b = document.createElement('button');
    b.className = 'demo-row';
    b.dataset.i = i;
    const nm = document.createElement('span');
    nm.className = 'dr-name';
    nm.textContent = m.name || `Model ${i}`;
    const sb = document.createElement('span');
    sb.className = 'dr-sub';
    sb.textContent = m.subtitle || m.category || 'Demo';
    b.append(nm, sb);
    b.onclick = () => scene.setModel(i);
    demoList.appendChild(b);
  });
}
renderDemos();

scene.onModel = (i, def, g) => {
  const mName = $('m-name');
  const mSub = $('m-sub');
  const mCat = $('m-cat');
  const mCount = $('m-count');
  if (mName) mName.textContent = def.name || 'Model';
  if (mSub) mSub.textContent = def.subtitle || '';
  if (mCat) mCat.textContent = def.category || 'General';
  if (mCount) mCount.textContent = `${g.meta.length} parts`;
  if (chips) {
    chips.querySelectorAll('button').forEach((b) => b.classList.toggle('active', +b.dataset.i === i));
  }
  if (demoList) {
    demoList.querySelectorAll('button').forEach((b) => b.classList.toggle('active', +b.dataset.i === i));
  }
  showPart(-1);
  toast(def.name || 'Model');
};

if (scene.models.length > 0 && scene.onModel && scene.cache.size > 0) {
  scene.onModel(scene.index, MODELS[scene.index], scene.cache.get(scene.index));
}

function showPart(i) {
  const p = i >= 0 && scene.parts ? scene.parts[i] : null;
  const pcName = $('pc-name');
  const pcDesc = $('pc-desc');
  const pcDot = $('pc-dot');
  if (pcName) pcName.textContent = p ? p.name : 'No part selected';
  if (pcDesc) pcDesc.textContent = p ? p.desc : 'Point at a part, or click one, to read what it does.';
  if (pcDot) pcDot.style.background = p ? p.color : '#555a70';
}

const rExplode = $('r-explode');
const rInt = $('r-int');
let draggingExplode = false;
if (rExplode) rExplode.addEventListener('pointerdown', () => (draggingExplode = true));
addEventListener('pointerup', () => (draggingExplode = false));
if (rExplode) rExplode.addEventListener('input', () => { if (scene) scene.explodeTarget = rExplode.value / 100; });
if (rInt) rInt.addEventListener('input', () => {
  if (scene) scene.intensity = rInt.value / 100;
  const vInt = $('v-int');
  if (vInt) vInt.textContent = rInt.value + '%';
});

const bExplode = $('b-explode');
const bSpin = $('b-spin');
const bReset = $('b-reset');
const bNext = $('b-next');
if (bExplode) bExplode.onclick = () => { if (scene) scene.explodeTarget = scene.explodeTarget > 0.5 ? 0 : 1; };
if (bSpin) bSpin.onclick = () => {
  if (scene) {
    scene.autoSpin = !scene.autoSpin;
    bSpin.classList.toggle('on', scene.autoSpin);
  }
};
if (bReset) bReset.onclick = () => {
  if (scene) scene.resetView();
  showPart(-1);
};
if (bNext) bNext.onclick = () => { if (scene) scene.next(); };

const bImport = $('b-import');
const bAddPart = $('b-add');
const cadInput = Object.assign(document.createElement('input'), { type: 'file', accept: '.stl,.obj,.ply,.gltf,.glb,.fbx' });
const partInput = Object.assign(document.createElement('input'), { type: 'file', accept: '.stl,.obj,.ply,.gltf,.glb,.fbx' });

if (bImport) bImport.onclick = () => cadInput.click();
cadInput.onchange = async () => {
  const file = cadInput.files?.[0];
  cadInput.value = '';
  if (!file || !scene) return;
  try {
    toast(`Importing ${file.name}...`);
    const root = await loadModelFile(file);
    const groups = flattenAssembly(root);
    if (!groups.length) throw new Error('No geometry found');
    const bounds = groupBounds(groups);
    const c = bounds.getCenter(new THREE.Vector3());
    let area = 0;
    for (const g of groups) {
      const meshes = g.meshes || [g.mesh].filter(Boolean);
      for (const m of meshes) if (m.geometry) area += meshArea(m.geometry);
    }
    const chunks = [];
    for (const g of groups) {
      const meshes = g.meshes || [g.mesh].filter(Boolean);
      for (const m of meshes) {
        if (!m.geometry) continue;
        const mArea = meshArea(m.geometry);
        const share = Math.max(100, Math.round((area * 0.004) * (mArea / Math.max(area,1e-9))));
        chunks.push(sampleMesh(m.geometry, m.matrix || g.matrix || new THREE.Matrix4(), share));
      }
    }
    const cloud = recenterChunks(chunks, c.x, c.y, c.z);
    const cn = centroid(cloud);
    const dir = [cn[0], cn[1], cn[2]];
    const dlen = Math.hypot(dir[0],dir[1],dir[2])||1;
    const dsc = (Math.max(bounds.getSize(new THREE.Vector3()).length(), 1)*0.3)/dlen;
    const base = file.name.replace(/\.[^.]+$/, '');
    const part = { name: base, desc: 'Imported CAD design', color: '#7fa3ff', anchor: [0,0,0], dir: [dir[0]*dsc, dir[1]*dsc, dir[2]*dsc] };
    const packed = [{
      name: part.name,
      desc: part.desc,
      color: part.color,
      instances: [{ cloud: { p: cloud, n: cloud.length/3 }, dir: part.dir, anchor: [0,0,0] }]
    }];
    const modelDef = {
      id: 'imported',
      name: base,
      category: 'Imported',
      subtitle: 'User uploaded CAD',
      view: { x: 0.25, y: -0.5, z: 0 },
      build: () => packed,
      parts: packed,
      pack: { json: { origin: [c.x,c.y,c.z], radius: bounds.getSize(new THREE.Vector3()).length() } }
    };
    scene.models.push(modelDef);
    const idx = scene.models.length - 1;
    const chips = $('chips');
    if (chips) {
      const grp = document.createElement('div');
      grp.className = 'grp';
      const gl = document.createElement('span'); gl.className='gl'; gl.textContent='Imported'; grp.appendChild(gl);
      const b = document.createElement('button'); b.textContent = modelDef.name; b.dataset.i = idx; b.onclick = () => scene.setModel(idx); grp.appendChild(b);
      chips.appendChild(grp);
    }
    scene.setModel(idx);
    toast('Imported successfully');
  } catch (e) { console.error(e); toast('Import failed'); }
};

if (bAddPart) bAddPart.onclick = () => partInput.click();
partInput.onchange = async () => {
  const file = partInput.files?.[0];
  partInput.value = '';
  if (!file || !scene || scene.models.length === 0) return;
  try {
    toast('Adding part...');
    const { part } = await addPartFromFile(file, scene.getPack(), { align: true });
    if (scene.appendPart) scene.appendPart(part);
    toast('Part added');
  } catch (e) { console.error(e); toast('Add part failed'); }
};

function toggle(id, key, after) {
  const el = $(id);
  if (!el) return;
  el.onclick = () => {
    ui[key] = !ui[key];
    el.classList.toggle('on', ui[key]);
    after?.();
  };
}
toggle('t-feed', 'feed', () => document.body.classList.toggle('feed', ui.feed && camOn));
toggle('t-skel', 'skeleton');
toggle('t-labels', 'labels');
const tFull = $('t-full');
if (tFull) tFull.onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.());

const tracker = new HandTracker();
const engine = new GestureEngine();
let camOn = false;
let lastVideoTime = -1;
let perc = { hands: [] };

async function startCamera() {
  const start = $('start');
  if (start) start.classList.add('gone');
  setTracking('Starting…', 'warn');
  if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
    enterMouseMode('Camera needs http://localhost or https.');
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false });
    video.srcObject = stream;
    await video.play();
    camOn = true;
    ui.feed = true;
    const tFeed = $('t-feed');
    if (tFeed) tFeed.classList.add('on');
    document.body.classList.add('feed');
  } catch (e) {
    console.warn(e);
    enterMouseMode(e && e.name === 'NotAllowedError' ? 'Camera permission denied. Allow it in the address bar and reload.' : 'No camera found.');
    return;
  }
  setTracking('Loading hand model…', 'warn');
  try {
    await tracker.init();
    setTracking('Hands on', 'ok');
    showBanner('');
  } catch (e) {
    console.error(e);
    setTracking('Mouse only', 'warn');
    showBanner('Hand model failed to load (needs internet once). Mouse controls still work.');
  }
}

function enterMouseMode(msg) {
  setTracking('Mouse only', 'warn');
  if (msg) showBanner(msg + ' Mouse controls are on.', true);
}

function setTracking(text, cls) {
  trackingState = text;
  const el = $('s-track');
  if (el) { el.textContent = text; el.className = cls || ''; }
}

const btnCam = $('btn-cam');
const btnMouse = $('btn-mouse');
const btnDemo = $('btn-demo');
if (btnCam) btnCam.onclick = startCamera;
if (btnMouse) btnMouse.onclick = () => {
  const start = $('start');
  if (start) start.classList.add('gone');
  enterMouseMode('');
};
if (btnDemo) btnDemo.onclick = () => {
  const start = $('start');
  if (start) start.classList.add('gone');
  enterMouseMode('');
  if (scene && MODELS.length) scene.setModel(0);
  toast('Demo designs ready — switch with the chips below');
};

function mapPoint(p) {
  const vw = video.videoWidth || 1280, vh = video.videoHeight || 720;
  const s = Math.max(W / vw, H / vh);
  const ox = (W - vw * s) / 2, oy = (H - vh * s) / 2;
  return { x: ((1 - p.x) * vw * s + ox) / W, y: (p.y * vh * s + oy) / H };
}

let zoomRef = null;
let grab = null;
let lastHover = { i: -1, t: 0 };
let dwell = { i: -1, t: 0 };
let peaceCool = 0;
const prevPalm = new Map();
let activeKey = '';

function setActive(key) {
  if (key === activeKey) return;
  activeKey = key;
  document.querySelectorAll('#gest li').forEach((li) => li.classList.toggle('active', li.dataset.g === key));
}

function endGrab() {
  if (grab) scene.releaseAll();
  grab = null;
}

function control(t, dt) {
  const live = perc.hands.filter((h) => !h.held);
  const sHands = $('s-hands');
  if (sHands) sHands.textContent = String(live.length);

  if (live.length >= 2) {
    const a = live[0].palm, b = live[1].palm;
    const dist = Math.hypot((a.x - b.x) * W, (a.y - b.y) * H);
    if (!zoomRef) zoomRef = { d0: Math.max(60, dist), s0: scene.scaleTarget };
    scene.scaleTarget = clamp((zoomRef.s0 * dist) / zoomRef.d0, 0.5, 2.6);
    scene.holdVel = true;
    scene.idle = 0;
    endGrab();
    scene.setHover(-1);
    prevPalm.clear();
    setActive('TWO');
    return;
  }
  zoomRef = null;

  const h = live[0];
  if (!h) {
    endGrab();
    scene.holdVel = draggingMouse;
    if (!draggingMouse) scene.setHover(-1);
    prevPalm.clear();
    setActive('');
    return;
  }

  scene.holdVel = true;
  scene.idle = 0;
  const g = h.gesture;
  const palmPx = { x: h.palm.x * W, y: h.palm.y * H };

  if (g === 'OPEN' || g === 'FIST' || g === 'NONE') {
    scene.explodeTarget = g === 'FIST' ? 0 : clamp((h.openness - 0.12) / 0.78, 0, 1);
    const prev = prevPalm.get(h.id);
    if (prev) {
      const dx = palmPx.x - prev.x, dy = palmPx.y - prev.y;
      if (Math.hypot(dx, dy) > 1.5) scene.rotateBy(dx * 0.0048, dy * 0.0032, dt);
    }
    if (h.rollDelta) scene.rollBy(h.rollDelta * 0.7);
    scene.setHover(-1);
    setActive(g === 'NONE' ? 'MOVE' : g);
    if (g === 'OPEN' && prev && Math.hypot(palmPx.x - prev.x, palmPx.y - prev.y) > 6) setActive('MOVE');
  } else {
    if (g === 'POINT') {
      const idx = scene.pick(h.tip.x * W, h.tip.y * H, 95);
      scene.setHover(idx);
      if (idx >= 0) {
        lastHover = { i: idx, t };
        showPart(idx);
      }
      if (idx >= 0 && idx === dwell.i) {
        dwell.t += dt;
        if (dwell.t > 0.7 && scene.sel !== idx) scene.setSel(idx);
      } else dwell = { i: idx, t: 0 };
    } else if (g === 'PINCH') {
      const pp = { x: h.pinchPt.x * W, y: h.pinchPt.y * H };
      if (!grab) {
        let idx = scene.pick(pp.x, pp.y, 170);
        if (idx < 0 && t - lastHover.t < 0.9) idx = lastHover.i;
        if (idx >= 0) {
          grab = { part: idx, last: pp };
          scene.setSel(idx);
          scene.setHover(idx);
          showPart(idx);
        }
      } else {
        scene.dragPart(grab.part, pp.x - grab.last.x, pp.y - grab.last.y);
        grab.last = pp;
      }
    } else if (g === 'PEACE') {
      if (t > peaceCool) {
        peaceCool = t + 1.6;
        scene.next();
      }
    }
    setActive(g);
  }
  if (g !== 'PINCH') endGrab();
  prevPalm.set(h.id, palmPx);
}

let draggingMouse = false;
let mouseStart = null;
let mouseLast = null;
const onUi = (e) => e.target.closest && e.target.closest('#panel,#chips,#toolbar,#start');
addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || onUi(e)) return;
  draggingMouse = true;
  mouseStart = mouseLast = { x: e.clientX, y: e.clientY };
});
addEventListener('pointermove', (e) => {
  if (!draggingMouse) return;
  if (scene) {
    scene.holdVel = true;
    scene.rotateBy((e.clientX - mouseLast.x) * 0.006, (e.clientY - mouseLast.y) * 0.004, 1 / 60);
  }
  mouseLast = { x: e.clientX, y: e.clientY };
});
addEventListener('pointerup', (e) => {
  if (!draggingMouse) return;
  draggingMouse = false;
  if (scene) scene.holdVel = false;
  if (Math.hypot(e.clientX - mouseStart.x, e.clientY - mouseStart.y) < 5) {
    const idx = scene.pick(e.clientX, e.clientY, 80);
    scene.setSel(idx === scene.sel ? -1 : idx);
    showPart(scene.sel);
  }
});
addEventListener('wheel', (e) => {
  if (onUi(e)) return;
  if (scene) scene.zoomBy(Math.exp(-e.deltaY * 0.0012));
}, { passive: true });
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  if (!scene) return;
  if (e.key === ' ') {
    e.preventDefault();
    scene.explodeTarget = scene.explodeTarget > 0.5 ? 0 : 1;
  } else if (e.key === 'ArrowRight') scene.next(1);
  else if (e.key === 'ArrowLeft') scene.next(-1);
  else if (e.key.toLowerCase() === 'r') scene.resetView();
  else if (e.key >= '1' && e.key <= String(MODELS.length)) scene.setModel(+e.key - 1);
});

const ringR = new Map();
function drawHand(h) {
  const pts = h.lm.map((p) => ({ x: p.x * W, y: p.y * H }));
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(236, 232, 255, 0.78)';
  ctx.shadowColor = 'rgba(176, 164, 255, 0.95)';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  for (const [a, b] of HAND_CONNECTIONS) {
    ctx.moveTo(pts[a].x, pts[a].y);
    ctx.lineTo(pts[b].x, pts[b].y);
  }
  ctx.stroke();
  ctx.fillStyle = '#fff';
  for (const p of pts) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawRing(h) {
  const pts = h.lm;
  const cx = h.palm.x * W, cy = h.palm.y * H;
  const g = h.gesture;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(242, 201, 76, 0.9)';
  ctx.shadowBlur = 14;
  if (g === 'POINT') {
    const x = h.tip.x * W, y = h.tip.y * H;
    ctx.strokeStyle = '#f2c94c';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, y, 20, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  } else if (g === 'PINCH') {
    const x = h.pinchPt.x * W, y = h.pinchPt.y * H;
    ctx.strokeStyle = '#f2c94c';
    ctx.fillStyle = 'rgba(242, 201, 76, 0.35)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    const len = Math.hypot((pts[0].x - pts[12].x) * W, (pts[0].y - pts[12].y) * H);
    const target = len * 0.95 + 22;
    const r = (ringR.get(h.id) ?? target) * 0.85 + target * 0.15;
    ringR.set(h.id, r);
    ctx.strokeStyle = 'rgba(242, 201, 76, 0.95)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    const e = clamp(scene.explode, 0, 1);
    if (e > 0.01) {
      ctx.shadowColor = 'rgba(255,255,255,0.9)';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * e);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawZoom(a, b) {
  const x1 = a.palm.x * W, y1 = a.palm.y * H, x2 = b.palm.x * W, y2 = b.palm.y * H;
  ctx.save();
  ctx.strokeStyle = 'rgba(242, 201, 76, 0.85)';
  ctx.setLineDash([6, 6]);
  ctx.lineWidth = 2;
  ctx.shadowColor = 'rgba(242, 201, 76, 0.8)';
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#fff';
  ctx.font = '600 13px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.shadowBlur = 6;
  ctx.fillText(`zoom ${scene.scale.toFixed(2)}x`, (x1 + x2) / 2, (y1 + y2) / 2 - 12);
  ctx.restore();
}

function drawLabels() {
  const e = clamp((scene.shownExplode - 0.1) / 0.3, 0, 1);
  if (e <= 0.01 || scene.uniforms.uScatter.value > 0.3) return;
  const pts = scene.labelPoints();
  const c = scene.centerScreen();
  const panelR = W > 900 ? 310 : 0;
  const left = [], right = [];
  for (const p of pts) (p.x < c.x ? left : right).push(p);
  const maxX = Math.max(...pts.map((p) => p.x), c.x);
  const minX = Math.min(...pts.map((p) => p.x), c.x);
  const colR = clamp(maxX + 80, panelR + 360, W - 170);
  const colL = clamp(minX - 80, panelR + 20, W - 400);
  ctx.save();
  ctx.globalAlpha = e;
  ctx.font = '500 12px ui-sans-serif, system-ui, "Segoe UI", sans-serif';
  ctx.textBaseline = 'middle';
  const place = (list, colX, dir) => {
    list.sort((a, b) => a.y - b.y);
    const ys = list.map((p) => p.y);
    for (let i = 1; i < ys.length; i++) if (ys[i] < ys[i-1] + 20) ys[i] = ys[i-1] + 20;
    const over = ys.length ? ys[ys.length-1] - (H-90) : 0;
    if (over > 0) for (let i = 0; i < ys.length; i++) ys[i] -= over;
    list.forEach((p, k) => {
      const hot = p.i === scene.hover || p.i === scene.sel;
      const ly = clamp(ys[k], 24, H-24);
      ctx.strokeStyle = hot ? p.color : 'rgba(255,255,255,0.38)';
      ctx.lineWidth = hot ? 1.6 : 1;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(colX - dir*16, ly);
      ctx.lineTo(colX, ly);
      ctx.stroke();
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, hot ? 4 : 2.4, 0, Math.PI*2);
      ctx.fill();
      ctx.fillStyle = hot ? '#fff' : 'rgba(255,255,255,0.82)';
      ctx.font = `${hot ? 600 : 500} ${hot ? 13 : 12}px ui-sans-serif, system-ui, "Segoe UI", sans-serif`;
      ctx.textAlign = dir > 0 ? 'left' : 'right';
      ctx.fillText(p.name, colX + dir*6, ly);
    });
  };
  place(right, colR, 1);
  place(left, colL, -1);
  ctx.restore();
}

function drawOverlay() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const tLabels = $('t-labels');
  const tSkel = $('t-skel');
  if (tLabels ? ui.labels : ui.labels) drawLabels();
  const live = perc.hands.filter((h) => !h.held);
  if (ui.skeleton) for (const h of live) drawHand(h);
  for (const h of live) drawRing(h);
  if (live.length >= 2) drawZoom(live[0], live[1]);
}

let lastT = performance.now() / 1000;
function frame(now) {
  const t = now / 1000;
  const dt = Math.min(0.05, Math.max(0.001, t - lastT));
  lastT = t;
  if (camOn && tracker.ready && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const hands = tracker.detect(video, now);
    perc = engine.update(hands, t, mapPoint, (video.videoWidth || 16) / (video.videoHeight || 9));
  }
  control(t, dt);
  if (!draggingExplode && rExplode) {
    rExplode.value = Math.round(clamp(scene.explode, 0, 1) * 100);
    const vExp = $('v-explode');
    if (vExp) vExp.textContent = Math.round(clamp(scene.explode, 0, 1) * 100) + '%';
  }
  const bExp = $('b-explode');
  if (bExp) bExp.textContent = scene.explodeTarget > 0.5 ? 'Assemble' : 'Explode';
  scene.update(dt, t);
  drawOverlay();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

import './styles.css';
import { HoloScene } from './scene.js';
import { MODELS, DEMO_MODELS } from './models/index.js';
import { HandTracker } from './handTracking.js';
import { GestureEngine, HAND_CONNECTIONS } from './gestureEngine.js';
import { clamp } from './utils.js';
import { addPartFromFile } from './editing/addPart.js';
import { loadModelFile } from './import/loaders.js';
import { buildImportedModel } from './import/modelFactory.js';
import { buildAssemblyModel } from './import/assemblyModel.js';
import {
  ApiError,
  BackendUnavailableError,
  backendHealth,
  deleteModel,
  listModels,
  loadGlbFromBackend,
  uploadStl,
} from './api/models.js';

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

const ui = { skeleton: true, labels: true, feed: false, controlsHidden: false };
let trackingState = 'Off';
let holoOn = true;
try { holoOn = localStorage.getItem('holo.surface') !== 'off'; } catch { /* private mode */ }
let scene;
const backendState = { online: false, checked: false, info: null, models: [], loaded: new Map() };

try {
  scene = new HoloScene($('scene'), MODELS);
  scene.setHologramEnabled(holoOn);
} catch (e) {
  console.error(e);
  showBanner('WebGL is not available. Use a current Chrome, Edge or Firefox with hardware acceleration on.');
  throw e;
}

const chips = $('chips');
if (chips && MODELS.length > 0) {
  for (const cat of [...new Set(MODELS.map((m) => m.category || 'General'))]) {
    const grp = document.createElement('div');
    grp.className = 'grp';
    grp.dataset.cat = cat;
    const gl = document.createElement('span');
    gl.className = 'gl';
    gl.textContent = cat;
    grp.appendChild(gl);
    MODELS.forEach((m, i) => {
      if ((m.category || 'General') !== cat) return;
      const b = document.createElement('button');
      b.textContent = m.name || `Model ${i}`;
      b.dataset.i = i;
      if (m.demo) b.classList.add('demo');
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

const savedList = $('saved-list');
const savedCount = $('saved-count');

function setBackendState(kind, text) {
  const dot = $('backend-dot');
  const label = $('backend-state');
  if (dot) dot.className = `dot ${kind}`;
  if (label) label.textContent = text;
}

function updateSavedCount() {
  if (savedCount) savedCount.textContent = String(backendState.models.length);
}

function appendChip(modelDef, idx) {
  if (!chips) return;
  let group = [...chips.querySelectorAll('.grp')].find((g) => g.dataset.cat === 'Imported');
  if (!group) {
    group = document.createElement('div');
    group.className = 'grp';
    group.dataset.cat = 'Imported';
    const label = document.createElement('span');
    label.className = 'gl';
    label.textContent = 'Imported';
    group.appendChild(label);
    chips.appendChild(group);
  }
  const button = document.createElement('button');
  button.textContent = modelDef.name || 'Imported';
  button.dataset.i = idx;
  button.onclick = () => scene.setModel(idx);
  group.appendChild(button);
}

function registerModel(modelDef) {
  MODELS.push(modelDef);
  const idx = MODELS.length - 1;
  appendChip(modelDef, idx);
  return idx;
}

function markSavedActive() {
  if (!savedList) return;
  const def = MODELS[scene.index];
  savedList.querySelectorAll('.saved-load').forEach((button) => {
    button.classList.toggle('active', !!def?.backendId && button.dataset.backendId === def.backendId);
  });
}

function renderSavedModels() {
  if (!savedList) return;
  savedList.innerHTML = '';
  updateSavedCount();

  if (!backendState.online) {
    const message = document.createElement('p');
    message.className = 'demo-empty';
    message.textContent = 'Backend offline — visual imports still work in the browser.';
    savedList.appendChild(message);
    return;
  }

  if (backendState.models.length === 0) {
    const message = document.createElement('p');
    message.className = 'demo-empty';
    message.textContent = 'Upload an STL to build your hologram library.';
    savedList.appendChild(message);
    return;
  }

  for (const record of backendState.models) {
    const row = document.createElement('div');
    row.className = 'saved-row';

    const load = document.createElement('button');
    load.className = 'saved-load';
    load.dataset.backendId = record.id;
    const name = document.createElement('span');
    name.className = 'dr-name';
    name.textContent = record.name || record.originalName || 'Imported model';
    const sub = document.createElement('span');
    sub.className = 'dr-sub';
    sub.textContent = `${formatCount(record.triangleCount)} tris · ${formatBytes(record.glbBytes)}`;
    load.append(name, sub);
    load.onclick = () => loadSavedModel(record).catch((error) => {
      console.error(error);
      toast(error instanceof ApiError ? error.message : 'Could not load saved model');
    });

    const remove = document.createElement('button');
    remove.className = 'saved-del';
    remove.title = 'Delete from library';
    remove.setAttribute('aria-label', `Delete ${name.textContent}`);
    remove.textContent = '×';
    remove.onclick = () => removeSavedModel(record);

    row.append(load, remove);
    savedList.appendChild(row);
  }
  markSavedActive();
}

async function loadSavedModel(record) {
  const existing = backendState.loaded.get(record.id);
  if (existing !== undefined && MODELS[existing]) {
    scene.setModel(existing);
    return;
  }
  toast(`Loading ${record.name}…`);
  const root = await loadGlbFromBackend(record.id);
  const built = buildImportedModel(root, {
    fileName: `${record.name || 'model'}.stl`,
    name: record.name,
    backendId: record.id,
    center: [0, 0, 0],
    origin: record.originalCenter || [0, 0, 0],
    radius: record.radius,
    triangleCount: record.triangleCount,
    vertexCount: record.vertexCount,
    subtitle: `${formatCount(record.triangleCount)} triangles · backend GLB`,
  });
  const idx = registerModel(built.modelDef);
  backendState.loaded.set(record.id, idx);
  scene.setModel(idx);
  toast(`${record.name} ready`);
}

async function removeSavedModel(record) {
  if (!confirm(`Delete "${record.name}" from the saved library?`)) return;
  try {
    await deleteModel(record.id);
    backendState.models = backendState.models.filter((model) => model.id !== record.id);
    renderSavedModels();
    toast('Deleted from library');
  } catch (error) {
    console.error(error);
    toast(error instanceof ApiError ? error.message : 'Delete failed');
  }
}

async function refreshSavedModels() {
  try {
    backendState.info = await backendHealth();
    backendState.online = true;
    backendState.checked = true;
    setBackendState('ok', `Backend ready · ${formatCount(backendState.info.maxTriangles)} tri cap`);
    backendState.models = await listModels();
    renderSavedModels();
  } catch (error) {
    backendState.online = false;
    backendState.checked = true;
    setBackendState('off', 'Backend offline · local import only');
    renderSavedModels();
  }
}

const demoImport = $('demo-import');
if (demoImport) {
  demoImport.onclick = () => {
    const imp = $('b-import');
    if (!imp) return;
    imp.classList.remove('pulse');
    void imp.offsetWidth;
    imp.classList.add('pulse');
    imp.click();
  };
}

scene.onModel = (i, def, g) => {
  const mName = $('m-name');
  const mSub = $('m-sub');
  const mCat = $('m-cat');
  const mCount = $('m-count');
  const mStats = $('m-stats');
  if (mName) mName.textContent = def.name || 'Model';
  if (mSub) mSub.textContent = def.subtitle || '';
  if (mStats) {
    if (def.importStats) {
      mStats.style.display = '';
      mStats.textContent = `${formatCount(def.importStats.triangles)} tris`;
    } else {
      mStats.style.display = 'none';
      mStats.textContent = '';
    }
  }
  if (mCat) {
    const cat = def.category || 'General';
    mCat.textContent = def.demo ? `Demo · ${cat}` : cat;
    mCat.classList.toggle('demo', !!def.demo);
  }
  if (mCount) mCount.textContent = `${g.meta.length} parts`;
  if (chips) {
    chips.querySelectorAll('button').forEach((b) => b.classList.toggle('active', +b.dataset.i === i));
  }
  if (demoList) {
    demoList.querySelectorAll('button').forEach((b) => b.classList.toggle('active', +b.dataset.i === i));
  }
  showPart(-1);
  markSavedActive();
  const holoButton = $('t-holo');
  if (holoButton) {
    holoButton.disabled = !def.surface;
    holoButton.classList.toggle('on', holoOn && !!def.surface);
  }
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
const cadInput = Object.assign(document.createElement('input'), { type: 'file', accept: '.stl,.obj,.ply,.gltf,.glb,.fbx', multiple: true });
const partInput = Object.assign(document.createElement('input'), { type: 'file', accept: '.stl,.obj,.ply,.gltf,.glb,.fbx', multiple: true });

function formatCount(value) {
  return Number(value || 0).toLocaleString();
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

async function importStlWithBackend(file) {
  let lastPercent = -1;
  const record = await uploadStl(file, {
    onProgress(progress) {
      const percent = Math.floor(progress * 100);
      if (percent >= lastPercent + 10 || percent === 100) {
        lastPercent = percent;
        toast(`Uploading ${percent}%`);
      }
    },
  });

  toast('Mesh processed — building the hologram');
  const root = await loadGlbFromBackend(record.id);
  const built = buildImportedModel(root, {
    fileName: file.name,
    name: record.name,
    backendId: record.id,
    center: [0, 0, 0],
    origin: record.originalCenter || [0, 0, 0],
    radius: record.radius,
    triangleCount: record.triangleCount,
    vertexCount: record.vertexCount,
    subtitle: `${formatCount(record.triangleCount)} triangles · backend GLB`,
  });

  const idx = registerModel(built.modelDef);
  backendState.online = true;
  backendState.checked = true;
  backendState.models = [record, ...backendState.models.filter((model) => model.id !== record.id)];
  backendState.loaded.set(record.id, idx);
  renderSavedModels();
  scene.setModel(idx);
  toast(`${record.name} hologram ready`);
  return idx;
}

async function importLocalCad(file) {
  toast(`Importing ${file.name}…`);
  const root = await loadModelFile(file);
  const built = buildImportedModel(root, {
    fileName: file.name,
    subtitle: 'Browser import · hologram surface',
  });
  const idx = registerModel(built.modelDef);
  scene.setModel(idx);
  toast(`${formatCount(built.stats.points)} hologram points ready`);
  return idx;
}

async function importCadFile(file) {
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
  if (ext !== '.stl') return importLocalCad(file);

  if (backendState.online || !backendState.checked) {
    try {
      return await importStlWithBackend(file);
    } catch (error) {
      if (error instanceof BackendUnavailableError) {
        backendState.online = false;
        backendState.checked = true;
        setBackendState('off', 'Backend offline · local import only');
        renderSavedModels();
        toast('Backend offline — importing locally');
      } else if (error instanceof ApiError) {
        console.error(error);
        toast(`Import failed: ${error.message}`);
        return null;
      } else {
        console.error(error);
        toast('Backend import failed — trying locally');
      }
    }
  }
  return importLocalCad(file);
}

function shiftCloud(cloud, x, y, z) {
  if (!cloud?.length) return cloud;
  const out = new Float32Array(cloud.length);
  for (let i = 0; i < cloud.length; i += 3) {
    out[i] = cloud[i] + x;
    out[i + 1] = cloud[i + 1] + y;
    out[i + 2] = cloud[i + 2] + z;
  }
  return out;
}

async function importFilesAsAssembly(files) {
  const entries = [];
  for (let i = 0; i < files.length; i++) {
    toast(`Importing part ${i + 1}/${files.length}…`);
    try {
      const entry = await addPartFromFile(files[i], null, { align: false });
      entries.push(entry);
    } catch (error) {
      console.warn(`Could not import ${files[i].name}`, error);
    }
  }
  if (!entries.length) throw new Error('None of those files could be imported');

  const maxRadius = Math.max(...entries.map((entry) => entry.radius || 1), 1);
  const cell = maxRadius * 2.25;
  const cols = Math.ceil(Math.sqrt(entries.length));
  const rows = Math.ceil(entries.length / cols);
  let radius = 0;

  const placed = entries.map((entry, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = (col - (cols - 1) / 2) * cell;
    const y = ((rows - 1) / 2 - row) * cell;
    const cloud = shiftCloud(entry.cloud, x, y, 0);
    entry.surface?.translate(x, y, 0);
    const part = {
      ...entry.part,
      anchor: [entry.part.anchor[0] + x, entry.part.anchor[1] + y, entry.part.anchor[2]],
      surface: entry.surface,
    };
    radius = Math.max(radius, Math.hypot(x, y, 0) + (entry.radius || 1));
    return { ...entry, part, cloud };
  });

  const { modelDef } = buildAssemblyModel(placed, {
    name: `Assembly · ${placed.length} parts`,
    radius,
  });
  const idx = registerModel(modelDef);
  scene.setModel(idx);
  toast(`${placed.length} parts imported — pinch one and lock it to another`);
  return idx;
}

async function importCadFiles(files) {
  const list = [...(files || [])];
  if (!list.length) return null;
  if (list.length === 1) return importCadFile(list[0]);
  return importFilesAsAssembly(list);
}

async function appendCadFiles(files) {
  if (!scene || scene.models.length === 0) return 0;
  const pack = scene.getPack();
  const items = [];
  for (let i = 0; i < files.length; i++) {
    toast(`Adding part ${i + 1}/${files.length}…`);
    try {
      const { part, cloud, surface } = await addPartFromFile(files[i], pack, { align: true });
      part.surface = surface;
      items.push({ part, cloud, surface });
    } catch (error) {
      console.warn(`Could not add ${files[i].name}`, error);
    }
  }
  const added = scene.appendParts ? scene.appendParts(items) : 0;
  if (added) toast(added === 1 ? 'Part added' : `${added} parts added`);
  else toast('No parts added');
  return added;
}

if (bImport) bImport.onclick = () => cadInput.click();
cadInput.onchange = async () => {
  const files = [...(cadInput.files || [])];
  cadInput.value = '';
  if (!files.length || !scene) return;
  try {
    await importCadFiles(files);
  } catch (error) {
    console.error(error);
    toast(error.message || 'Import failed');
  }
};

let dragDepth = 0;
function hasDroppedFiles(event) {
  return !!event.dataTransfer && [...(event.dataTransfer.types || [])].includes('Files');
}
addEventListener('dragenter', (event) => {
  if (!hasDroppedFiles(event)) return;
  event.preventDefault();
  dragDepth++;
  document.body.classList.add('dragging');
});
addEventListener('dragover', (event) => {
  if (hasDroppedFiles(event)) event.preventDefault();
});
addEventListener('dragleave', (event) => {
  if (!hasDroppedFiles(event)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) document.body.classList.remove('dragging');
});
addEventListener('drop', async (event) => {
  if (!hasDroppedFiles(event)) return;
  event.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  const files = [...(event.dataTransfer.files || [])];
  if (!files.length || !scene) return;
  try {
    await importCadFiles(files);
  } catch (error) {
    console.error(error);
    toast(error.message || 'Import failed');
  }
});

if (bAddPart) bAddPart.onclick = () => partInput.click();
partInput.onchange = async () => {
  const files = [...(partInput.files || [])];
  partInput.value = '';
  if (!files.length || !scene || scene.models.length === 0) return;
  try {
    await appendCadFiles(files);
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
const tHolo = $('t-holo');
if (tHolo) {
  tHolo.classList.toggle('on', holoOn);
  tHolo.onclick = () => {
    holoOn = !holoOn;
    scene.setHologramEnabled(holoOn);
    tHolo.classList.toggle('on', holoOn && !!scene.hasSurface);
    try { localStorage.setItem('holo.surface', holoOn ? 'on' : 'off'); } catch { /* private mode */ }
    toast(holoOn ? 'Hologram surface on' : 'Hologram surface off');
  };
}
const tFull = $('t-full');
if (tFull) tFull.onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.());

const controlsToggle = $('controls-toggle');
function setControlsHidden(hidden, opts = {}) {
  hidden = !!hidden;
  if (hidden === ui.controlsHidden) return;
  ui.controlsHidden = hidden;
  document.body.classList.toggle('controls-hidden', hidden);
  if (controlsToggle) {
    controlsToggle.title = hidden ? 'Show controls' : 'Hide controls';
    controlsToggle.setAttribute('aria-label', hidden ? 'Show controls' : 'Hide controls');
    controlsToggle.setAttribute('aria-expanded', String(!hidden));
  }
  if (scene && scene.setPanelVisible) scene.setPanelVisible(!hidden);
  try { localStorage.setItem('holo.controls', hidden ? 'hidden' : 'shown'); } catch { /* private mode */ }
  if (!opts.silent) toast(hidden ? 'Controls hidden — full view' : 'Controls shown');
}
if (controlsToggle) controlsToggle.onclick = () => setControlsHidden(!ui.controlsHidden);
try {
  if (localStorage.getItem('holo.controls') === 'hidden') setControlsHidden(true, { silent: true });
} catch { /* private mode */ }

const tracker = new HandTracker();
const engine = new GestureEngine();
let camOn = false;
let lastVideoTime = -1;
let perc = { hands: [] };
let inputMode = 'mouse';

async function startCamera() {
  const start = $('start');
  if (start) start.classList.add('gone');
  setTracking('Starting…', 'warn');
  if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
    enterMouseMode('Camera needs http://localhost or https.');
    return false;
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
    return false;
  }
  setTracking('Loading hand model…', 'warn');
  try {
    if (!tracker.ready) await tracker.init();
    setTracking('Hands on', 'ok');
    showBanner('');
    return true;
  } catch (e) {
    console.error(e);
    showBanner('Hand model failed to load (needs internet once). Mouse controls still work.');
    return false;
  }
}

function stopCamera() {
  camOn = false;
  const stream = video.srcObject;
  if (stream && stream.getTracks) stream.getTracks().forEach((tr) => tr.stop());
  video.srcObject = null;
  lastVideoTime = -1;
  perc = { hands: [] };
  ui.feed = false;
  document.body.classList.remove('feed');
  const tFeed = $('t-feed');
  if (tFeed) tFeed.classList.remove('on');
  endGrab();
  if (scene) scene.setHover(-1);
}

function updateModeButton() {
  const b = $('b-mode');
  if (!b) return;
  const hand = inputMode === 'hand';
  b.textContent = hand ? 'Switch to mouse control' : 'Switch to hand gestures';
  b.title = hand ? 'Turn the webcam off and use the mouse' : 'Turn the webcam on and control with your hands';
  b.classList.toggle('on', hand);
}

async function setInputMode(mode) {
  mode = mode === 'hand' ? 'hand' : 'mouse';
  if (mode === inputMode && (mode === 'mouse' || camOn)) {
    updateModeButton();
    return;
  }
  inputMode = mode;
  updateModeButton();
  if (mode === 'hand') {
    toast('Hand gestures on — show your hands');
    const ok = await startCamera();
    if (!ok) {
      inputMode = 'mouse';
      updateModeButton();
      stopCamera();
      setTracking('Mouse only', 'warn');
    }
  } else {
    stopCamera();
    setTracking('Mouse only', 'warn');
    toast('Mouse control on');
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
if (btnCam) btnCam.onclick = () => setInputMode('hand');
if (btnMouse) btnMouse.onclick = () => {
  const start = $('start');
  if (start) start.classList.add('gone');
  setInputMode('mouse');
  enterMouseMode('');
};
if (btnDemo) btnDemo.onclick = () => {
  const start = $('start');
  if (start) start.classList.add('gone');
  setInputMode('mouse');
  enterMouseMode('');
  if (scene && MODELS.length) scene.setModel(0);
  toast('Demo designs ready — switch with the chips below');
};

const bMode = $('b-mode');
if (bMode) bMode.onclick = () => setInputMode(inputMode === 'hand' ? 'mouse' : 'hand');
updateModeButton();

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
  const live = inputMode === 'hand' ? perc.hands.filter((h) => !h.held) : [];
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
const onUi = (e) => e.target.closest && e.target.closest('#panel,#chips,#toolbar,#start,#controls-toggle');
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
  else if (e.key.toLowerCase() === 'h') setControlsHidden(!ui.controlsHidden);
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
  const panelR = W > 900 && !ui.controlsHidden ? 310 : 0;
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
  if (inputMode !== 'hand' && perc.hands.length) perc = { hands: [] };
  if (inputMode === 'hand' && camOn && tracker.ready && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
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
refreshSavedModels();
requestAnimationFrame(frame);

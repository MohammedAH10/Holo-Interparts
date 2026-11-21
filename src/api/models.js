const BASE = (import.meta.env?.VITE_HOLO_API || '/api').replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(message, status = 0, code = 'api_error') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export class BackendUnavailableError extends ApiError {
  constructor(message = 'The model backend is offline') {
    super(message, 0, 'backend_unavailable');
    this.name = 'BackendUnavailableError';
  }
}

export async function backendHealth(timeout = 2500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`${BASE}/health`, { signal: controller.signal, cache: 'no-store' });
    if (!res.ok) throw new ApiError('Backend health check failed', res.status, 'health_failed');
    return await res.json();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new BackendUnavailableError();
  } finally {
    clearTimeout(timer);
  }
}

export async function listModels() {
  const res = await request('/models');
  return res.models || [];
}

export async function getModel(id) {
  const res = await request(`/models/${encodeURIComponent(id)}`);
  return res.model;
}

export async function deleteModel(id) {
  await request(`/models/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return true;
}

export function uploadStl(file, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append('file', file, file.name);
    xhr.open('POST', `${BASE}/models`);
    xhr.responseType = 'json';
    xhr.timeout = 120_000;

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(event.loaded / event.total, event.loaded, event.total);
      }
    };
    xhr.onload = () => {
      const payload = xhr.response || safeJson(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300 && payload?.model) {
        resolve(payload.model);
        return;
      }
      reject(new ApiError(payload?.message || `Upload failed (${xhr.status})`, xhr.status, payload?.error || 'upload_failed'));
    };
    xhr.onerror = () => reject(new BackendUnavailableError('Could not reach the model backend'));
    xhr.ontimeout = () => reject(new ApiError('The upload timed out', 0, 'upload_timeout'));
    xhr.onabort = () => reject(new ApiError('Upload cancelled', 0, 'upload_cancelled'));
    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        return;
      }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(form);
  });
}

export function modelFileUrl(id) {
  return `${BASE}/models/${encodeURIComponent(id)}/model.glb`;
}

export function sourceFileUrl(id) {
  return `${BASE}/models/${encodeURIComponent(id)}/source.stl`;
}

export async function loadGlbFromBackend(id) {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(modelFileUrl(id));
  return gltf.scene;
}

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { accept: 'application/json', ...(options.headers || {}) },
      cache: 'no-store',
      ...options,
    });
  } catch {
    throw new BackendUnavailableError();
  }
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  if (!res.ok) {
    if (res.status === 0) throw new BackendUnavailableError();
    throw new ApiError(payload?.message || `Request failed (${res.status})`, res.status, payload?.error || 'request_failed');
  }
  return payload;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { safeId } from './http.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_DATA_DIR = path.join(HERE, 'data');

export class ModelStore {
  constructor(dataDir = process.env.HOLO_DATA_DIR || DEFAULT_DATA_DIR) {
    this.dataDir = path.resolve(dataDir);
    this.modelsDir = path.join(this.dataDir, 'models');
    this.ready = fs.mkdir(this.modelsDir, { recursive: true });
  }

  async saveModel({ originalName, sourceBuffer, glbBuffer, metadata }) {
    await this.ready;
    const id = `${slug(originalName)}-${crypto.randomBytes(4).toString('hex')}`;
    const dir = this.modelDir(id);
    await fs.mkdir(dir, { recursive: true });

    const record = {
      id,
      name: metadata.name || stripExtension(originalName),
      originalName,
      createdAt: new Date().toISOString(),
      sourceFormat: 'stl',
      sourceBytes: sourceBuffer.length,
      glbBytes: glbBuffer.length,
      ...metadata,
      files: {
        source: `/api/models/${id}/source.stl`,
        model: `/api/models/${id}/model.glb`,
      },
    };

    await fs.writeFile(path.join(dir, 'source.stl'), sourceBuffer);
    await fs.writeFile(path.join(dir, 'model.glb'), glbBuffer);
    await fs.writeFile(path.join(dir, 'model.json'), JSON.stringify(record, null, 2));
    return record;
  }

  async listModels() {
    await this.ready;
    let entries = [];
    try {
      entries = await fs.readdir(this.modelsDir, { withFileTypes: true });
    } catch {
      return [];
    }
    const models = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !safeId(entry.name)) continue;
      try {
        const raw = await fs.readFile(path.join(this.modelsDir, entry.name, 'model.json'), 'utf8');
        models.push(JSON.parse(raw));
      } catch {
        // Ignore half-written or corrupt folders.
      }
    }
    return models.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async getModel(id) {
    if (!safeId(id)) return null;
    try {
      const raw = await fs.readFile(path.join(this.modelDir(id), 'model.json'), 'utf8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async readGlb(id) {
    if (!safeId(id)) return null;
    try {
      return await fs.readFile(path.join(this.modelDir(id), 'model.glb'));
    } catch {
      return null;
    }
  }

  async readSource(id) {
    if (!safeId(id)) return null;
    try {
      return await fs.readFile(path.join(this.modelDir(id), 'source.stl'));
    } catch {
      return null;
    }
  }

  async removeModel(id) {
    if (!safeId(id)) return false;
    try {
      await fs.rm(this.modelDir(id), { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }

  modelDir(id) {
    return path.join(this.modelsDir, id);
  }
}

function slug(value) {
  const base = stripExtension(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || 'model';
}

function stripExtension(value) {
  return String(value || 'model').replace(/\.[^.]+$/, '');
}

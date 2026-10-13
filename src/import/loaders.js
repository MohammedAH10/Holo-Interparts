import * as THREE from 'three';

export class FileLoader3D {
  constructor() {
    this.supported = ['.stl', '.obj', '.gltf', '.glb', '.fbx', '.ply'];
  }

  async loadFromFile(file) {
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
    const url = URL.createObjectURL(file);
    try {
      if (ext === '.stl') {
        const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
        const loader = new STLLoader();
        return await new Promise((resolve, reject) => {
          loader.load(url, (geom) => resolve({ geometry: geom, mesh: null }), undefined, reject);
        });
      } else if (ext === '.obj') {
        const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
        const loader = new OBJLoader();
        return await new Promise((resolve, reject) => {
          loader.load(url, (obj) => resolve({ object: obj, geometry: null }), undefined, reject);
        });
      } else if (ext === '.gltf' || ext === '.glb') {
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
        const loader = new GLTFLoader();
        return await new Promise((resolve, reject) => {
          loader.load(url, (gltf) => resolve({ gltf, object: gltf.scene }), undefined, reject);
        });
      } else if (ext === '.fbx') {
        const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
        const loader = new FBXLoader();
        return await new Promise((resolve, reject) => {
          loader.load(url, (obj) => resolve({ object: obj }), undefined, reject);
        });
      } else if (ext === '.ply') {
        const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js');
        const loader = new PLYLoader();
        return await new Promise((resolve, reject) => {
          loader.load(url, (geom) => resolve({ geometry: geom }), undefined, reject);
        });
      }
    } finally {
      URL.revokeObjectURL(url);
    }
    throw new Error(`Unsupported format: ${ext}`);
  }
}

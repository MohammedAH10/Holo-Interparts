const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

export function meshToGlb(mesh, { name = 'model', color = [0.31, 0.89, 0.88, 1] } = {}) {
  const vertexCount = mesh.positions.length / 3;
  if (vertexCount === 0 || mesh.indices.length === 0) {
    throw new Error('Cannot export an empty mesh');
  }

  const useUint16 = vertexCount <= 65535;
  const indices = useUint16 ? Uint16Array.from(mesh.indices) : Uint32Array.from(mesh.indices);
  const positions = mesh.positions;
  const normals = mesh.normals;
  const indexBuffer = typedBuffer(indices);
  const positionBuffer = typedBuffer(positions);
  const normalBuffer = typedBuffer(normals);

  const indexOffset = 0;
  const positionOffset = align4(indexOffset + indexBuffer.length);
  const normalOffset = align4(positionOffset + positionBuffer.length);
  const binaryLength = align4(normalOffset + normalBuffer.length);
  const binary = Buffer.alloc(binaryLength);
  indexBuffer.copy(binary, indexOffset);
  positionBuffer.copy(binary, positionOffset);
  normalBuffer.copy(binary, normalOffset);

  const json = {
    asset: { version: '2.0', generator: 'Holo-Interparts-3D backend' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    meshes: [{
      name,
      primitives: [{
        attributes: { POSITION: 1, NORMAL: 2 },
        indices: 0,
        material: 0,
        mode: 4,
      }],
    }],
    materials: [{
      name: 'Holo surface',
      pbrMetallicRoughness: {
        baseColorFactor: color,
        metallicFactor: 0.35,
        roughnessFactor: 0.28,
      },
      emissiveFactor: [color[0] * 0.25, color[1] * 0.25, color[2] * 0.25],
      doubleSided: true,
    }],
    accessors: [
      {
        bufferView: 0,
        componentType: useUint16 ? 5123 : 5125,
        count: indices.length,
        type: 'SCALAR',
      },
      {
        bufferView: 1,
        componentType: 5126,
        count: vertexCount,
        type: 'VEC3',
        min: mesh.bounds.min,
        max: mesh.bounds.max,
      },
      {
        bufferView: 2,
        componentType: 5126,
        count: vertexCount,
        type: 'VEC3',
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: indexOffset, byteLength: indexBuffer.length, target: ELEMENT_ARRAY_BUFFER },
      { buffer: 0, byteOffset: positionOffset, byteLength: positionBuffer.length, target: ARRAY_BUFFER },
      { buffer: 0, byteOffset: normalOffset, byteLength: normalBuffer.length, target: ARRAY_BUFFER },
    ],
    buffers: [{ byteLength: binary.length }],
  };

  const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPaddedLength = align4(jsonBuffer.length);
  const totalLength = 12 + 8 + jsonPaddedLength + 8 + binary.length;
  const glb = Buffer.alloc(totalLength);
  let offset = 0;

  glb.writeUInt32LE(GLB_MAGIC, offset); offset += 4;
  glb.writeUInt32LE(2, offset); offset += 4;
  glb.writeUInt32LE(totalLength, offset); offset += 4;

  glb.writeUInt32LE(jsonPaddedLength, offset); offset += 4;
  glb.writeUInt32LE(CHUNK_JSON, offset); offset += 4;
  jsonBuffer.copy(glb, offset);
  glb.fill(0x20, offset + jsonBuffer.length, offset + jsonPaddedLength);
  offset += jsonPaddedLength;

  glb.writeUInt32LE(binary.length, offset); offset += 4;
  glb.writeUInt32LE(CHUNK_BIN, offset); offset += 4;
  binary.copy(glb, offset);

  return glb;
}

function typedBuffer(array) {
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
}

function align4(value) {
  return (value + 3) & ~3;
}

import { parseStl } from './stl.mjs';
import { cleanMesh, simplifyMesh, centerMesh } from './mesh.mjs';
import { meshToGlb } from './glb.mjs';

export const DEFAULT_MAX_TRIANGLES = Number(process.env.HOLO_MAX_TRIANGLES) || 250_000;

export function processStl(buffer, { name = 'model', maxTriangles = DEFAULT_MAX_TRIANGLES } = {}) {
  const parsed = parseStl(buffer);
  const cleaned = cleanMesh(parsed);
  const simplified = simplifyMesh(cleaned, maxTriangles);
  const centered = centerMesh(simplified);
  const glb = meshToGlb(centered, {
    name,
    color: [0.31, 0.89, 0.88, 1],
  });

  return {
    glb,
    meta: {
      sourceFormat: parsed.format,
      sourceTriangleCount: parsed.triangleCount,
      triangleCount: centered.triangleCount,
      vertexCount: centered.vertexCount,
      simplified: centered.simplified,
      maxTriangles,
      removedTriangles: centered.removedTriangles || 0,
      originalCenter: cleaned.center,
      originalBounds: cleaned.bounds,
      bounds: centered.bounds,
      radius: centered.radius,
    },
  };
}

export function buildAssemblyModel(entries = [], options = {}) {
  const parts = [];
  let points = 0;
  let radius = 0;

  for (const entry of entries) {
    if (!entry?.part) continue;
    const cloud = entry.cloud;
    if (cloud?.length) points += cloud.length / 3;
    radius = Math.max(radius, entry.radius || 0);
    parts.push({
      name: entry.part.name || 'Part',
      desc: entry.part.desc || '',
      color: entry.part.color || '#4fe3e0',
      surface: entry.surface || entry.part.surface || null,
      instances: cloud?.length ? [{
        cloud: { p: cloud, n: cloud.length / 3 },
        anchor: entry.part.anchor || [0, 0, 0],
      }] : [],
    });
  }

  const name = options.name || 'Assembly';
  const modelDef = {
    id: `assembly-${Date.now()}`,
    name,
    category: 'Assembly',
    subtitle: parts.length
      ? `${parts.length} body part${parts.length === 1 ? '' : 's'} · pinch and lock to build`
      : 'Empty assembly · import parts to start',
    view: { x: 0.25, y: -0.5, z: 0 },
    assembly: true,
    build: () => parts,
    parts,
    pack: {
      json: {
        origin: [0, 0, 0],
        radius: Math.max(radius, 2),
      },
    },
    importStats: {
      points,
      triangles: 0,
      vertices: 0,
      radius: Math.max(radius, 2),
    },
  };

  return { modelDef, parts };
}

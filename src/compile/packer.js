export class ModelPacker {
  pack(parts, metadata = {}) {
    let total = 0;
    for (const p of parts) {
      if (p.instances) {
        for (const inst of p.instances) {
          total += inst.cloud.length / 3;
        }
      }
    }
    
    const pos = new Float32Array(total * 3);
    const dir = new Float32Array(total * 3);
    let k = 0;
    const meta = parts.map(p => ({
      name: p.name || 'Part',
      desc: p.desc || '',
      color: p.color || '#7fa3ff',
      instances: (p.instances || []).map(inst => ({
        dir: inst.dir || [0,0,0],
        anchor: inst.anchor || [0,0,0],
        count: (inst.cloud.length / 3) || 0,
        offset: k * 3
      })),
      labels: p.labels || []
    }));
    
    for (let pi = 0; pi < parts.length; pi++) {
      const p = parts[pi];
      if (p.instances) {
        for (const inst of p.instances) {
          const n = inst.cloud.length / 3;
          for (let i = 0; i < n; i++) {
            pos[k*3 + 0] = inst.cloud[i*3 + 0];
            pos[k*3 + 1] = inst.cloud[i*3 + 1];
            pos[k*3 + 2] = inst.cloud[i*3 + 2];
            dir[k*3 + 0] = inst.dir[0] || 0;
            dir[k*3 + 1] = inst.dir[1] || 0;
            dir[k*3 + 2] = inst.dir[2] || 0;
            k++;
          }
        }
      }
    }
    
    return {
      json: {
        version: 1,
        name: metadata.name || 'Model',
        category: metadata.category || 'General',
        subtitle: metadata.subtitle || '',
        view: metadata.view || { x: 0, y: 0, z: 0 },
        totalPoints: total,
        parts: meta
      },
      bin: {
        pos,
        dir
      }
    };
  }
}

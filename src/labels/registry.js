export const DEFAULT_LABELS = new Map();

export function registerLabel(id, label) {
  if (id && label) {
    DEFAULT_LABELS.set(String(id), {
      name: label.name || id,
      desc: label.desc || ''
    });
  }
}

export function getLabel(id) {
  return DEFAULT_LABELS.get(String(id)) || {
    name: String(id),
    desc: ''
  };
}

export function loadLabels(labels = {}) {
  for (const [k, v] of Object.entries(labels)) {
    registerLabel(k, v);
  }
}

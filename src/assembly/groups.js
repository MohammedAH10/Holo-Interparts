export function createPartGroups(count) {
  const n = Math.max(0, Number(count) || 0);
  return Array.from({ length: n }, (_, i) => i);
}

export function normalizePartGroups(groups, count) {
  const n = Math.max(0, Number(count) || 0);
  const out = createPartGroups(n);
  if (!Array.isArray(groups)) return out;
  for (let i = 0; i < Math.min(n, groups.length); i++) {
    const value = groups[i];
    out[i] = Number.isInteger(value) && value >= 0 && value < n ? value : i;
  }
  return out;
}

export function groupMembers(groups, index) {
  if (!Array.isArray(groups) || index < 0 || index >= groups.length) return [];
  const group = groups[index];
  const members = [];
  for (let i = 0; i < groups.length; i++) {
    if (groups[i] === group) members.push(i);
  }
  return members;
}

export function groupSize(groups, index) {
  return groupMembers(groups, index).length;
}

export function isLinked(groups, index) {
  return groupSize(groups, index) > 1;
}

export function mergePartGroups(groups, a, b) {
  if (!Array.isArray(groups) || a < 0 || b < 0 || a >= groups.length || b >= groups.length) return false;
  if (a === b || groups[a] === groups[b]) return false;
  const from = groups[b];
  const to = groups[a];
  for (let i = 0; i < groups.length; i++) {
    if (groups[i] === from) groups[i] = to;
  }
  return true;
}

export function resetPartGroups(groups) {
  if (!Array.isArray(groups)) return groups;
  for (let i = 0; i < groups.length; i++) groups[i] = i;
  return groups;
}

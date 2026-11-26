import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPartGroups,
  groupMembers,
  groupSize,
  isLinked,
  mergePartGroups,
  normalizePartGroups,
  resetPartGroups,
} from '../src/assembly/groups.js';

test('creates one group per part', () => {
  assert.deepEqual(createPartGroups(4), [0, 1, 2, 3]);
  assert.deepEqual(normalizePartGroups([0, 0, 9], 4), [0, 0, 2, 3]);
});

test('merges two part groups and reports their members', () => {
  const groups = createPartGroups(5);
  assert.equal(mergePartGroups(groups, 1, 3), true);
  assert.deepEqual(groupMembers(groups, 1), [1, 3]);
  assert.deepEqual(groupMembers(groups, 3), [1, 3]);
  assert.equal(groupSize(groups, 3), 2);
  assert.equal(isLinked(groups, 1), true);
  assert.equal(isLinked(groups, 2), false);
});

test('merges whole groups and refuses empty or repeated merges', () => {
  const groups = createPartGroups(5);
  mergePartGroups(groups, 0, 1);
  mergePartGroups(groups, 2, 3);
  assert.equal(mergePartGroups(groups, 4, 0), true);
  assert.deepEqual(groupMembers(groups, 4), [0, 1, 4]);
  assert.equal(mergePartGroups(groups, 4, 2), true);
  assert.deepEqual(groupMembers(groups, 4), [0, 1, 2, 3, 4]);
  assert.equal(mergePartGroups(groups, 3, 2), false);
  assert.equal(mergePartGroups(groups, -1, 2), false);
});

test('resets groups back to one per part', () => {
  const groups = [0, 1, 2];
  mergePartGroups(groups, 0, 2);
  resetPartGroups(groups);
  assert.deepEqual(groups, [0, 1, 2]);
});

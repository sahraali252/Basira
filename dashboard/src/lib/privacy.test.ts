import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateShield, summarize } from './privacy';
import { mockEvents } from '../data/mockEvents';
test('demo comparison stays consistent with request statuses', () => {
  const before = summarize(mockEvents);
  const after = summarize(simulateShield(mockEvents, true));
  assert.equal(before.detected, 12);
  assert.equal(before.active, 12);
  assert.equal(before.score, 38);
  assert.equal(after.active, 2);
  assert.equal(after.blocked, 10);
  assert.equal(after.score, 96);
  assert.equal(after.risk, 'low');
});
test('Shield preserves original data and existing blocked requests', () => {
  const original = structuredClone(mockEvents);
  simulateShield(mockEvents, true);
  assert.deepEqual(mockEvents, original);
  assert.deepEqual(simulateShield(mockEvents, false), original);
  assert.equal(simulateShield([{ ...mockEvents[0], blocked: true }], false)[0].blocked, true);
});
test('empty sessions, duplicate domains, and score boundaries', () => {
  assert.deepEqual(summarize([]), { score: 100, risk: 'low', detected: 0, active: 0, blocked: 0 });
  assert.equal(summarize([mockEvents[0], { ...mockEvents[0], id: 'repeat' }]).detected, 1);
  assert.equal(summarize(Array.from({ length: 30 }, (_, i) => ({ ...mockEvents[0], id: String(i) }))).score, 0);
});

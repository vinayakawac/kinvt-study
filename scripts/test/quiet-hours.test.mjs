import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './harness.mjs';

const Q = () => loadModules(['quiet-hours.js']).KinvtQuietHours;
const at = (h, m = 0) => h * 60 + m;

test('a window crossing midnight covers both sides of it', () => {
  const q = Q();
  const [start, end] = [at(22), at(7)];
  // The default window, and the case a naive start <= now < end gets wrong.
  assert.equal(q.isQuiet(at(23), start, end), true, '23:00 is inside');
  assert.equal(q.isQuiet(at(2), start, end), true, '02:00 is inside');
  assert.equal(q.isQuiet(at(6, 59), start, end), true);
  assert.equal(q.isQuiet(at(7), start, end), false, 'end is exclusive');
  assert.equal(q.isQuiet(at(12), start, end), false);
  assert.equal(q.isQuiet(at(21, 59), start, end), false);
  assert.equal(q.isQuiet(at(22), start, end), true, 'start is inclusive');
});

test('a window inside one day behaves normally', () => {
  const q = Q();
  assert.equal(q.isQuiet(at(14), at(13), at(15)), true);
  assert.equal(q.isQuiet(at(12), at(13), at(15)), false);
  assert.equal(q.isQuiet(at(16), at(13), at(15)), false);
});

test('an empty window silences nothing', () => {
  assert.equal(Q().isQuiet(at(3), at(9), at(9)), false);
});

test('nextAllowed returns now when not quiet', () => {
  assert.equal(Q().nextAllowed(at(12), at(22), at(7)), at(12));
});

test('nextAllowed returns the end of the window when quiet', () => {
  const q = Q();
  assert.equal(q.nextAllowed(at(23), at(22), at(7)), at(7) + 1440, 'tomorrow morning');
  assert.equal(q.nextAllowed(at(2), at(22), at(7)), at(7), 'later today');
});

test('isQuietAt falls back to the defaults when settings are missing', () => {
  const q = Q();
  const night = new Date(2026, 0, 1, 23, 30);
  const noon = new Date(2026, 0, 1, 12, 0);
  assert.equal(q.isQuietAt(night, {}), true);
  assert.equal(q.isQuietAt(noon, {}), false);
  assert.equal(q.isQuietAt(noon, { quietStart: at(11), quietEnd: at(13) }), true, 'settings win');
});

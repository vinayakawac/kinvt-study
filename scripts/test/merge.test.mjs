import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './harness.mjs';

const M = () => loadModules(['merge.js']).KinvtMerge;

const stats = (byDevice, byTopic = {}) =>
  ({ schema: 2, deviceId: 'dsk-aaa111', byDevice, byTopic, recent: [], streakByDevice: {} });
const entry = (o) => ({ misses: 1, streak: 0, updatedAt: 1000, updatedBy: 'dsk-1', retired: false, ...o });

/* ---------- stats ---------- */

test('merging disjoint devices keeps both contributions', () => {
  const m = M();
  const out = m.mergeStats(
    stats({ 'dsk-1': { answered: 10, correct: 6 } }),
    stats({ 'and-2': { answered: 4, correct: 3 } })
  );
  assert.deepEqual(m.totals(out), { answered: 14, correct: 9 });
});

test('the more advanced record wins for a device seen by both', () => {
  const m = M();
  const a = stats({ 'and-2': { answered: 4, correct: 3 } });
  const b = stats({ 'and-2': { answered: 9, correct: 7 } });
  assert.deepEqual(m.mergeStats(a, b).byDevice['and-2'], { answered: 9, correct: 7 });
  assert.deepEqual(m.mergeStats(b, a).byDevice['and-2'], { answered: 9, correct: 7 });
});

test('a record is taken whole, never field-wise', () => {
  const m = M();
  // Field-wise max would give {answered: 9, correct: 8} — more correct answers
  // than questions answered. Taking the record whole cannot produce that.
  const out = m.mergeStats(
    stats({ 'and-2': { answered: 5, correct: 8 } }),
    stats({ 'and-2': { answered: 9, correct: 2 } })
  );
  assert.deepEqual(out.byDevice['and-2'], { answered: 9, correct: 2 });
});

test('merging stats is idempotent — syncing twice inflates nothing', () => {
  const m = M();
  const a = stats({ 'dsk-1': { answered: 10, correct: 6 } });
  const b = stats({ 'and-2': { answered: 4, correct: 3 } });
  const once = m.mergeStats(a, b);
  const thrice = m.mergeStats(m.mergeStats(once, b), b);
  assert.deepEqual(m.totals(thrice), m.totals(once));
  assert.deepEqual(m.totals(once), { answered: 14, correct: 9 });
});

test('merging stats is commutative', () => {
  const m = M();
  const a = stats({ 'dsk-1': { answered: 10, correct: 6 }, 'and-2': { answered: 1, correct: 1 } });
  const b = stats({ 'and-2': { answered: 4, correct: 3 } });
  assert.deepEqual(m.mergeStats(a, b).byDevice, m.mergeStats(b, a).byDevice);
});

test('two divergent replicas converge after exchanging', () => {
  const m = M();
  const desktop = stats({ 'dsk-1': { answered: 20, correct: 15 } });
  const phone = stats({ 'and-2': { answered: 7, correct: 4 } });
  assert.deepEqual(m.mergeStats(desktop, phone).byDevice, m.mergeStats(phone, desktop).byDevice);
  assert.deepEqual(m.totals(m.mergeStats(desktop, phone)), { answered: 27, correct: 19 });
});

test('per-topic counters merge the same way', () => {
  const m = M();
  const out = m.mergeStats(
    stats({}, { upsc: { byDevice: { 'dsk-1': { answered: 8, correct: 5 } } } }),
    stats({}, {
      upsc: { byDevice: { 'and-2': { answered: 3, correct: 3 } } },
      ssc: { byDevice: { 'and-2': { answered: 2, correct: 1 } } }
    })
  );
  assert.deepEqual(m.topicTotals(out, 'upsc'), { answered: 11, correct: 8 });
  assert.deepEqual(m.topicTotals(out, 'ssc'), { answered: 2, correct: 1 });
  assert.deepEqual(m.topicTotals(out, 'never-seen'), { answered: 0, correct: 0 });
});

test('local-only fields are kept from local, never taken from remote', () => {
  const m = M();
  const a = { ...stats({ 'dsk-1': { answered: 1, correct: 1 } }), recent: [1, 0, 1], streakByDevice: { 'dsk-1': 4 } };
  const b = { ...stats({ 'and-2': { answered: 1, correct: 0 } }), recent: [0, 0], streakByDevice: { 'and-2': 9 } };
  const out = m.mergeStats(a, b);
  assert.deepEqual(out.recent, [1, 0, 1], 'recent describes this device only');
  assert.equal(out.streakByDevice['dsk-1'], 4);
  assert.equal(out.deviceId, 'dsk-aaa111');
});

test('merging tolerates missing sections', () => {
  const m = M();
  assert.deepEqual(m.totals(m.mergeStats({ schema: 2 }, { schema: 2 })), { answered: 0, correct: 0 });
});

/* ---------- review ---------- */

test('the later review update wins', () => {
  const m = M();
  const mine = { q: entry({ misses: 1, updatedAt: 1000 }) };
  const theirs = { q: entry({ misses: 5, updatedAt: 2000, updatedBy: 'and-2' }) };
  assert.equal(m.mergeReview(mine, theirs).q.misses, 5);
  assert.equal(m.mergeReview(theirs, mine).q.misses, 5);
});

test('an equal timestamp resolves the same way on both devices', () => {
  const m = M();
  const mine = { q: entry({ misses: 1, updatedAt: 5000, updatedBy: 'and-2' }) };
  const theirs = { q: entry({ misses: 9, updatedAt: 5000, updatedBy: 'dsk-1' }) };
  assert.deepEqual(m.mergeReview(mine, theirs), m.mergeReview(theirs, mine));
});

test('a retirement survives a stale un-retired copy from the peer', () => {
  const m = M();
  // The nastiest sync bug: delete a key and it comes straight back from the
  // peer. A tombstone is why retirement sticks.
  const retiredHere = { q: entry({ retired: true, updatedAt: 3000 }) };
  const stillActive = { q: entry({ retired: false, updatedAt: 1000, updatedBy: 'and-2' }) };
  assert.equal(m.mergeReview(retiredHere, stillActive).q.retired, true);
  assert.equal(m.mergeReview(stillActive, retiredHere).q.retired, true);
});

test('a genuine later miss revives a retired question', () => {
  const m = M();
  const out = m.mergeReview(
    { q: entry({ retired: true, updatedAt: 1000 }) },
    { q: entry({ retired: false, misses: 4, updatedAt: 9000, updatedBy: 'and-2' }) }
  ).q;
  assert.equal(out.retired, false);
  assert.equal(out.misses, 4);
});

test('merging review is idempotent and convergent', () => {
  const m = M();
  const a = { q1: entry({ updatedAt: 100 }), q2: entry({ updatedAt: 500 }) };
  const b = { q2: entry({ updatedAt: 900, updatedBy: 'and-2', misses: 3 }), q3: entry({ updatedBy: 'and-2' }) };
  const once = m.mergeReview(a, b);
  assert.deepEqual(m.mergeReview(once, b), once);
  assert.deepEqual(m.mergeReview(a, b), m.mergeReview(b, a));
});

test('pruneTombstones drops only old retired entries', () => {
  const m = M();
  const now = 1_000_000_000_000;
  const old = now - m.TOMBSTONE_MAX_AGE_MS - 1;
  const out = m.pruneTombstones({
    oldRetired: entry({ retired: true, updatedAt: old }),
    freshRetired: entry({ retired: true, updatedAt: now - 1000 }),
    oldActive: entry({ retired: false, updatedAt: old })
  }, now);
  assert.deepEqual(Object.keys(out).sort(), ['freshRetired', 'oldActive']);
});

/* ---------- settings ---------- */

test('a newer remote replaces the synced settings only', () => {
  const m = M();
  // A phone reminding you every 30 minutes is not the same request as a
  // desktop doing it, and the two screens are not the same screen.
  const local = { updatedAt: 100, topics: { upsc: true }, intervalMin: 30, theme: 'dark' };
  const remote = { updatedAt: 200, topics: { ssc: true }, intervalMin: 120, theme: 'light' };
  const out = m.mergeSettings(local, remote);
  assert.deepEqual(out.topics, { ssc: true }, 'topics travel');
  assert.equal(out.intervalMin, 30, 'interval does not');
  assert.equal(out.theme, 'dark', 'nor does appearance');
});

test('an older remote changes nothing', () => {
  const m = M();
  const local = { updatedAt: 500, topics: { upsc: true }, perQuiz: 3 };
  assert.deepEqual(m.mergeSettings(local, { updatedAt: 100, topics: { ssc: true } }), local);
});

test('merging settings is idempotent', () => {
  const m = M();
  const a = { updatedAt: 100, topics: { upsc: true } };
  const b = { updatedAt: 200, topics: { ssc: true } };
  const once = m.mergeSettings(a, b);
  assert.deepEqual(m.mergeSettings(once, b), once);
});

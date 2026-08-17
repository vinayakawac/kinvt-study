import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules, makeLocalStorage, CORE } from './harness.mjs';

const MODULES = ['merge.js', 'storage.js', 'progress.js'];
const load = (seed) => loadModules(MODULES, { localStorage: makeLocalStorage(seed) });
const q = (id, category, extra = {}) => ({ id, category, ...extra });

/* ---------- recording ---------- */

test('answers accumulate against this device', () => {
  const { KinvtProgress: P, KinvtMerge: M } = load();
  const me = P.thisDevice();
  P.recordAnswer(q('up-1', 'upsc'), true);
  P.recordAnswer(q('up-2', 'upsc'), false);
  const st = P.getStats();
  assert.deepEqual(st.byDevice[me], { answered: 2, correct: 1 });
  assert.deepEqual(M.totals(st), { answered: 2, correct: 1 });
  assert.deepEqual(M.topicTotals(st, 'upsc'), { answered: 2, correct: 1 });
});

test('totals include another device synced in', () => {
  const { KinvtProgress: P, KinvtMerge: M } = load({
    'kinvt.stats': JSON.stringify({
      schema: 2, deviceId: 'dsk-1',
      byDevice: { 'dsk-1': { answered: 10, correct: 6 }, 'and-2': { answered: 5, correct: 5 } },
      byTopic: {}, recent: [], streakByDevice: {}
    })
  });
  assert.deepEqual(M.totals(P.getStats()), { answered: 15, correct: 11 });
});

test('recent is capped at 30, newest last', () => {
  const { KinvtProgress: P } = load();
  for (let i = 0; i < 35; i++) P.recordAnswer(q(`x-${i}`, 'upsc'), i % 2 === 0);
  const st = P.getStats();
  assert.equal(st.recent.length, 30);
  assert.equal(st.recent[29], 1);
});

test('recordResult keeps a per-device perfect-run streak', () => {
  const { KinvtProgress: P } = load();
  P.recordResult(3, 3);
  assert.equal(P.streak(), 1);
  P.recordResult(1, 3);
  assert.equal(P.streak(), 0, 'an imperfect run breaks it');
});

/* ---------- spaced repetition ---------- */

test('a missed question enters review and retires after two correct', () => {
  const { KinvtProgress: P } = load();
  P.recordAnswer(q('up-7', 'upsc'), false);
  assert.equal(P.reviewCount(), 1);
  P.recordAnswer(q('up-7', 'upsc'), true);
  assert.equal(P.reviewCount(), 1, 'one correct could be a lucky guess');
  P.recordAnswer(q('up-7', 'upsc'), true);
  assert.equal(P.reviewCount(), 0);
});

test('retirement writes a tombstone rather than deleting', () => {
  const { KinvtProgress: P } = load();
  P.recordAnswer(q('up-7', 'upsc'), false);
  P.recordAnswer(q('up-7', 'upsc'), true);
  P.recordAnswer(q('up-7', 'upsc'), true);
  const review = P.getReview();
  assert.ok(review['up-7'], 'the entry must survive as a tombstone');
  assert.equal(review['up-7'].retired, true);
});

test('missing a retired question again revives it', () => {
  const { KinvtProgress: P } = load();
  P.recordAnswer(q('up-7', 'upsc'), false);
  P.recordAnswer(q('up-7', 'upsc'), true);
  P.recordAnswer(q('up-7', 'upsc'), true);
  assert.equal(P.reviewCount(), 0);
  P.recordAnswer(q('up-7', 'upsc'), false);
  assert.equal(P.reviewCount(), 1);
  assert.equal(P.getReview()['up-7'].retired, false);
});

test('a miss resets review progress', () => {
  const { KinvtProgress: P } = load();
  P.recordAnswer(q('up-8', 'upsc'), false);
  P.recordAnswer(q('up-8', 'upsc'), true);
  P.recordAnswer(q('up-8', 'upsc'), false);
  P.recordAnswer(q('up-8', 'upsc'), true);
  assert.equal(P.reviewCount(), 1, 'streak restarted, so not retired yet');
});

test('a retired question is never picked for review', () => {
  const { KinvtProgress: P } = load({
    'kinvt.review': JSON.stringify({
      dead: { misses: 9, streak: 0, updatedAt: 1, updatedBy: 'dsk-1', retired: true },
      live: { misses: 1, streak: 0, updatedAt: 1, updatedBy: 'dsk-1', retired: false }
    })
  });
  assert.deepEqual(P.pickReviewQuestions([q('dead', 'upsc'), q('live', 'upsc')], 5).map(x => x.id), ['live']);
});

test('pickReviewQuestions returns most-missed first, limited', () => {
  const { KinvtProgress: P } = load();
  P.recordAnswer(q('a', 'upsc'), false);
  P.recordAnswer(q('b', 'upsc'), false);
  P.recordAnswer(q('b', 'upsc'), false);
  const bank = [q('a', 'upsc'), q('b', 'upsc'), q('c', 'upsc')];
  assert.deepEqual(P.pickReviewQuestions(bank, 2).map(x => x.id), ['b', 'a']);
  assert.deepEqual(P.pickReviewQuestions(bank, 1).map(x => x.id), ['b']);
});

test('every review write stamps who and when', () => {
  const { KinvtProgress: P } = load();
  P.recordAnswer(q('up-9', 'upsc'), false);
  const e = P.getReview()['up-9'];
  assert.equal(e.updatedBy, P.thisDevice());
  assert.ok(e.updatedAt > 0);
});

/* ---------- derived views ---------- */

test('topicAccuracy is null until 5 attempts, then a ratio', () => {
  const { KinvtProgress: P } = load();
  for (let i = 0; i < 4; i++) P.recordAnswer(q(`a-${i}`, 'upsc'), true);
  assert.equal(P.topicAccuracy('upsc'), null, 'four attempts is not enough signal');
  P.recordAnswer(q('a-4', 'upsc'), false);
  assert.equal(P.topicAccuracy('upsc'), 0.8);
  assert.equal(P.topicAccuracy('never-seen'), null);
});

test('topicBreakdown sorts weakest first, unattempted last', () => {
  const { KinvtProgress: P } = load({
    'kinvt.stats': JSON.stringify({
      schema: 2, deviceId: 'dsk-1', byDevice: {},
      byTopic: {
        strong: { byDevice: { 'dsk-1': { answered: 10, correct: 9 } } },
        weak: { byDevice: { 'dsk-1': { answered: 10, correct: 2 } } },
        untouched: { byDevice: { 'dsk-1': { answered: 0, correct: 0 } } }
      },
      recent: [], streakByDevice: {}
    })
  });
  const rows = P.topicBreakdown();
  assert.deepEqual(rows.map(r => r.id), ['weak', 'strong', 'untouched']);
  assert.equal(rows[0].accuracy, 0.2);
  assert.equal(rows[2].accuracy, null);
});

/* ---------- migration ---------- */

test('v1 stats move wholesale onto this device', () => {
  const { KinvtProgress: P, KinvtMerge: M } = load();
  const out = P.migrate({
    answered: 120, correct: 80, streak: 3,
    byTopic: { upsc: { answered: 30, correct: 22 } }, recent: [1, 0, 1]
  }, 'dsk-abc123', 1000);
  assert.equal(out.schema, 2);
  assert.deepEqual(M.totals(out), { answered: 120, correct: 80 }, 'no totals lost');
  assert.deepEqual(M.topicTotals(out, 'upsc'), { answered: 30, correct: 22 });
  assert.equal(out.streakByDevice['dsk-abc123'], 3);
  assert.deepEqual(out.recent, [1, 0, 1]);
});

test('migrating an already-v2 object leaves it untouched', () => {
  const { KinvtProgress: P } = load();
  const v2 = { schema: 2, deviceId: 'dsk-1', byDevice: { 'dsk-1': { answered: 5, correct: 5 } }, byTopic: {}, recent: [], streakByDevice: {} };
  assert.deepEqual(P.migrate(v2, 'dsk-1', 1000), v2);
});

test('getStats migrates stored v1 data transparently', () => {
  const { KinvtProgress: P, KinvtMerge: M } = load({
    'kinvt.stats': JSON.stringify({ answered: 42, correct: 30, streak: 2, byTopic: { ssc: { answered: 10, correct: 7 } } })
  });
  const st = P.getStats();
  assert.equal(st.schema, 2);
  assert.deepEqual(M.totals(st), { answered: 42, correct: 30 });
  assert.deepEqual(M.topicTotals(st, 'ssc'), { answered: 10, correct: 7 });
});

test('v1 review entries gain a timestamp, an author and a retired flag', () => {
  const { KinvtProgress: P } = load();
  const out = P.migrateReview({ 'up-007': { misses: 3, streak: 0, lastMissedAt: 555 } }, 'dsk-1', 9999);
  assert.equal(out['up-007'].updatedAt, 555, 'lastMissedAt is the best timestamp available');
  assert.equal(out['up-007'].updatedBy, 'dsk-1');
  assert.equal(out['up-007'].retired, false);
  assert.equal(out['up-007'].misses, 3);
});

test('reading v1 data does not destroy it', () => {
  const localStorage = makeLocalStorage({
    'kinvt.stats': JSON.stringify({ answered: 42, correct: 30, streak: 2 })
  });
  loadModules(MODULES, { localStorage }).KinvtProgress.getStats();
  assert.ok(localStorage.getItem('kinvt.stats'), 'the only copy of the history survives a read');
});

/* ---------- backup, the bug that started all this ---------- */

const remotePayload = () => ({
  version: 2,
  exportedAt: '2026-01-01T00:00:00.000Z',
  deviceId: 'and-2',
  settings: { updatedAt: 50, topics: { ssc: true } },
  stats: {
    schema: 2, deviceId: 'and-2',
    byDevice: { 'and-2': { answered: 20, correct: 12 } },
    byTopic: { ssc: { byDevice: { 'and-2': { answered: 20, correct: 12 } } } },
    recent: [1, 1], streakByDevice: { 'and-2': 2 }
  },
  review: { 'ss-1': { misses: 2, streak: 0, updatedAt: 100, updatedBy: 'and-2', retired: false } }
});

test('importing the same payload repeatedly does not inflate totals', () => {
  const { KinvtProgress: P, KinvtMerge: M } = load();
  P.recordAnswer(q('up-1', 'upsc'), true);

  assert.deepEqual(P.importPayload(remotePayload()), { ok: true });
  const after1 = M.totals(P.getStats());
  P.importPayload(remotePayload());
  P.importPayload(remotePayload());

  // The old summing merge gave 61/37 here. This is the whole point.
  assert.deepEqual(M.totals(P.getStats()), after1);
  assert.deepEqual(after1, { answered: 21, correct: 13 });
});

test('local progress survives an import', () => {
  const { KinvtProgress: P } = load();
  P.recordAnswer(q('up-1', 'upsc'), true);
  P.importPayload(remotePayload());
  assert.deepEqual(P.getStats().byDevice[P.thisDevice()], { answered: 1, correct: 1 });
});

test('review entries from both sides are kept', () => {
  const { KinvtProgress: P } = load();
  P.recordAnswer(q('up-9', 'upsc'), false);
  P.importPayload(remotePayload());
  assert.equal(P.reviewCount(), 2);
});

test('a v1 backup is still accepted and migrated', () => {
  const { KinvtProgress: P, KinvtMerge: M } = load();
  assert.deepEqual(P.importPayload({
    version: 1,
    settings: { intervalMin: 45 },
    stats: { answered: 10, correct: 6, streak: 1, byTopic: { upsc: { answered: 10, correct: 6 } } },
    review: { 'up-3': { misses: 1, streak: 0, lastMissedAt: 5 } }
  }), { ok: true });
  assert.deepEqual(M.totals(P.getStats()), { answered: 10, correct: 6 });
});

test('rubbish is rejected without changing anything', () => {
  const { KinvtProgress: P, KinvtMerge: M } = load();
  P.recordAnswer(q('up-1', 'upsc'), true);
  const before = M.totals(P.getStats());
  assert.equal(P.importPayload({ version: 99 }).ok, false);
  assert.equal(P.importPayload(null).ok, false);
  assert.equal(P.importPayload({ version: 2 }).ok, false, 'no stats section');
  assert.deepEqual(M.totals(P.getStats()), before);
});

test('importing your own export is a no-op', () => {
  const { KinvtProgress: P, KinvtMerge: M } = load();
  P.recordAnswer(q('up-1', 'upsc'), true);
  P.recordAnswer(q('up-2', 'upsc'), false);
  const snapshot = JSON.parse(JSON.stringify(P.exportPayload()));
  const before = M.totals(P.getStats());
  P.importPayload(snapshot);
  assert.deepEqual(M.totals(P.getStats()), before);
});

/* ---------- device identity ---------- */

test('deviceId generates once then stays stable', () => {
  const { KinvtStorage: S } = load();
  const first = S.deviceId('dsk');
  assert.match(first, /^dsk-[0-9a-f]{6}$/);
  assert.equal(S.deviceId('dsk'), first);
});

test('two fresh installs get different ids', () => {
  const a = load().KinvtStorage.deviceId('dsk');
  const b = load().KinvtStorage.deviceId('dsk');
  assert.notEqual(a, b);
});

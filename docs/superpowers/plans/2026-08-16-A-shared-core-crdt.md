# Sub-project A — Shared Core and Conflict-Free Merge

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app's stored progress mergeable — so the same data can be exchanged between two devices any number of times, in any order, and both end up identical.

**Architecture:** Progress becomes a CRDT. Counters are kept per device and merged by taking the more advanced record; review entries are last-write-wins with tombstones. All merge logic is pure functions in one new module (`ui/merge.js`) with no I/O, so it is fully unit-testable without a device, a network or a shell.

**Tech Stack:** Vanilla ES5-style IIFE modules (no build step), `node --test` with the existing `vm` harness.

## Global Constraints

- **PREREQUISITE:** Tasks 1–4 of `docs/superpowers/plans/2026-08-16-app-improvements.md` must be complete first. This plan builds on `ui/storage.js`, `ui/progress.js` and `ui/selection.js` existing. Do not start Task 1 below until `node --test scripts/test/` passes with those modules present.
- **No build step for `desktop/ui/`.** Modules stay IIFEs over a `global` param. Never introduce `import`/`export` there.
- Every module ends with `})(typeof window !== 'undefined' ? window : globalThis);`
- **Merge functions must be pure** — no `localStorage`, no `Date.now()`, no `crypto` inside them. Timestamps and ids are passed in. This is what makes them testable and deterministic.
- **The three CRDT properties are non-negotiable** and every merge function is tested for them: idempotent (`merge(a,a) == a`), commutative (`merge(a,b) == merge(b,a)`), convergent (divergent replicas agree after exchange).
- `desktop/ui/` is the single source of truth; run `node scripts/sync-feed.mjs` after any change under it.
- Tests run from the repo root: `node --test scripts/test/`.
- Schema version for the new shape is `2`. Never write `schema: 2` data without having migrated.

---

### Task 1: Harness gains `crypto`, and device identity

**Files:**
- Modify: `scripts/test/harness.mjs`
- Modify: `desktop/ui/storage.js`
- Create: `scripts/test/identity.test.mjs`

**Interfaces:**
- Consumes: `KinvtStorage` from app-improvements Task 1.
- Produces:
  - `KinvtStorage.KEYS.deviceId` → `'kinvt.deviceId'`
  - `KinvtStorage.deviceId(prefix: string) -> string` — returns the stored id, generating and persisting `<prefix>-<6 hex chars>` on first call. Stable across calls.

- [ ] **Step 1: Give the sandbox a crypto object**

In `scripts/test/harness.mjs`, replace the `loadModules` sandbox construction:

```js
export function loadModules(files, { localStorage = makeLocalStorage() } = {}) {
  // Device ids and sync keys need getRandomValues; the vm context does not
  // inherit Node's globals, so it is passed in explicitly.
  const sandbox = { localStorage, console, crypto: globalThis.crypto };
  sandbox.window = sandbox;          // modules resolve `window` first
  vm.createContext(sandbox);
  for (const f of files) {
    const src = fs.readFileSync(path.join(UI_DIR, f), 'utf8');
    vm.runInContext(src, sandbox, { filename: f });
  }
  return sandbox;
}
```

- [ ] **Step 2: Write the failing test**

Create `scripts/test/identity.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules, makeLocalStorage } from './harness.mjs';

test('deviceId generates once and then stays stable', () => {
  const { KinvtStorage } = loadModules(['storage.js']);
  const first = KinvtStorage.deviceId('dsk');
  assert.match(first, /^dsk-[0-9a-f]{6}$/);
  assert.equal(KinvtStorage.deviceId('dsk'), first, 'must not regenerate');
});

test('deviceId persists to storage under its own key', () => {
  const localStorage = makeLocalStorage();
  const { KinvtStorage } = loadModules(['storage.js'], { localStorage });
  const id = KinvtStorage.deviceId('and');
  assert.equal(localStorage.getItem('kinvt.deviceId'), id);
});

test('an existing id is honoured whatever prefix is asked for', () => {
  const localStorage = makeLocalStorage({ 'kinvt.deviceId': 'dsk-abc123' });
  const { KinvtStorage } = loadModules(['storage.js'], { localStorage });
  assert.equal(KinvtStorage.deviceId('and'), 'dsk-abc123');
});

test('two fresh installs get different ids', () => {
  const a = loadModules(['storage.js'], { localStorage: makeLocalStorage() });
  const b = loadModules(['storage.js'], { localStorage: makeLocalStorage() });
  assert.notEqual(a.KinvtStorage.deviceId('dsk'), b.KinvtStorage.deviceId('dsk'));
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test scripts/test/identity.test.mjs`
Expected: FAIL — `KinvtStorage.deviceId is not a function`.

- [ ] **Step 4: Implement it**

In `desktop/ui/storage.js`, add `deviceId: 'kinvt.deviceId'` to the `KEYS` object, then add before the `global.KinvtStorage` assignment:

```js
  /* ---------- device identity ----------
   * Sync needs to attribute counters to the device that earned them, so each
   * install carries a short random id. It is not an account and holds no
   * personal data: it exists only so that two devices can tell their own
   * contributions apart when merging.
   */
  function deviceId(prefix) {
    var existing = null;
    try { existing = global.localStorage.getItem(KEYS.deviceId); } catch (e) { /* noop */ }
    if (existing) return existing;

    var bytes = new Uint8Array(3);
    global.crypto.getRandomValues(bytes);
    var id = prefix + '-' + Array.prototype.map
      .call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); })
      .join('');

    try { global.localStorage.setItem(KEYS.deviceId, id); } catch (e) { /* noop */ }
    return id;
  }
```

And add `deviceId: deviceId,` to the exported object.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test scripts/test/identity.test.mjs`
Expected: PASS — 4 tests.

- [ ] **Step 6: Commit**

```bash
git add scripts/test/harness.mjs desktop/ui/storage.js scripts/test/identity.test.mjs
git commit -m "Give each install a device id, so counters can be attributed"
```

---

### Task 2: `mergeStats` — per-device counters

**Files:**
- Create: `desktop/ui/merge.js`
- Create: `scripts/test/merge-stats.test.mjs`

**Interfaces:**
- Consumes: nothing (pure module, no dependencies).
- Produces (`global.KinvtMerge`):
  - `mergeStats(local: Stats, remote: Stats) -> Stats`
  - `totals(stats: Stats) -> {answered: number, correct: number}`
  - `topicTotals(stats: Stats, topicId: string) -> {answered: number, correct: number}`

  `Stats` is `{schema: 2, deviceId, byDevice: {[id]: {answered, correct}}, byTopic: {[topic]: {byDevice: {...}}}, recent: number[], streakByDevice: {[id]: number}}`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test/merge-stats.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './harness.mjs';

const M = () => loadModules(['merge.js']).KinvtMerge;

const stats = (byDevice, byTopic = {}) =>
  ({ schema: 2, deviceId: 'dsk-aaa111', byDevice, byTopic, recent: [], streakByDevice: {} });

test('merging disjoint devices keeps both contributions', () => {
  const m = M();
  const a = stats({ 'dsk-1': { answered: 10, correct: 6 } });
  const b = stats({ 'and-2': { answered: 4, correct: 3 } });
  const out = m.mergeStats(a, b);
  assert.deepEqual(out.byDevice['dsk-1'], { answered: 10, correct: 6 });
  assert.deepEqual(out.byDevice['and-2'], { answered: 4, correct: 3 });
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
  // than questions answered on the older snapshot. Taking the record whole
  // cannot produce that.
  const a = stats({ 'and-2': { answered: 5, correct: 8 } });
  const b = stats({ 'and-2': { answered: 9, correct: 2 } });
  const out = m.mergeStats(a, b).byDevice['and-2'];
  assert.deepEqual(out, { answered: 9, correct: 2 });
});

test('merging is idempotent — syncing twice does not inflate anything', () => {
  const m = M();
  const a = stats({ 'dsk-1': { answered: 10, correct: 6 } });
  const b = stats({ 'and-2': { answered: 4, correct: 3 } });
  const once = m.mergeStats(a, b);
  const twice = m.mergeStats(once, b);
  const thrice = m.mergeStats(twice, b);
  assert.deepEqual(m.totals(thrice), m.totals(once));
  assert.deepEqual(m.totals(once), { answered: 14, correct: 9 });
});

test('merging is commutative', () => {
  const m = M();
  const a = stats({ 'dsk-1': { answered: 10, correct: 6 }, 'and-2': { answered: 1, correct: 1 } });
  const b = stats({ 'and-2': { answered: 4, correct: 3 } });
  assert.deepEqual(m.mergeStats(a, b).byDevice, m.mergeStats(b, a).byDevice);
});

test('two divergent replicas converge after exchanging', () => {
  const m = M();
  let desktop = stats({ 'dsk-1': { answered: 20, correct: 15 } });
  let phone = stats({ 'and-2': { answered: 7, correct: 4 } });
  const d2 = m.mergeStats(desktop, phone);
  const p2 = m.mergeStats(phone, desktop);
  assert.deepEqual(d2.byDevice, p2.byDevice);
  assert.deepEqual(m.totals(d2), { answered: 27, correct: 19 });
});

test('per-topic counters merge the same way', () => {
  const m = M();
  const a = stats({}, { upsc: { byDevice: { 'dsk-1': { answered: 8, correct: 5 } } } });
  const b = stats({}, {
    upsc: { byDevice: { 'and-2': { answered: 3, correct: 3 } } },
    ssc: { byDevice: { 'and-2': { answered: 2, correct: 1 } } }
  });
  const out = m.mergeStats(a, b);
  assert.deepEqual(m.topicTotals(out, 'upsc'), { answered: 11, correct: 8 });
  assert.deepEqual(m.topicTotals(out, 'ssc'), { answered: 2, correct: 1 });
  assert.deepEqual(m.topicTotals(out, 'never-seen'), { answered: 0, correct: 0 });
});

test('local-only fields are kept from local and never taken from remote', () => {
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
  const out = m.mergeStats({ schema: 2 }, { schema: 2 });
  assert.deepEqual(m.totals(out), { answered: 0, correct: 0 });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/test/merge-stats.test.mjs`
Expected: FAIL — `ENOENT` on `desktop/ui/merge.js`.

- [ ] **Step 3: Write `merge.js`**

Create `desktop/ui/merge.js`:

```js
/*
 * Kinvt-study — merging two devices' progress.
 *
 * Sync repeats. That single fact rules out the obvious merge — adding the two
 * sides' counters together — because adding is not idempotent: sync the same
 * data twice and the totals double. (That is a real bug in the pre-sync
 * backup/restore, which summed on import.)
 *
 * So progress is stored as a CRDT instead. Counters are kept PER DEVICE, and
 * merging takes the more advanced record for each device rather than combining
 * them. A device's own counters only ever increase, so this is:
 *
 *   idempotent   merge(a, a) == a           — syncing twice changes nothing
 *   commutative  merge(a, b) == merge(b, a) — order of arrival is irrelevant
 *   convergent   both sides reach the same state after exchanging
 *
 * Totals are computed by summing across devices, never stored.
 *
 * Everything here is a pure function: no storage, no clock, no randomness.
 * That is what makes the properties above directly testable.
 */
(function (global) {
  'use strict';

  function counters(rec) {
    return {
      answered: (rec && rec.answered) || 0,
      correct: (rec && rec.correct) || 0
    };
  }

  // Take the whole record from whichever side is further along, rather than
  // the max of each field. A device's two counters advance together, so a
  // field-wise max could pair `answered` from one moment with `correct` from
  // another and report more correct answers than questions answered.
  function moreAdvanced(x, y) {
    if (!x) return counters(y);
    if (!y) return counters(x);
    if ((y.answered || 0) > (x.answered || 0)) return counters(y);
    if ((x.answered || 0) > (y.answered || 0)) return counters(x);
    // Same answered count: keep the higher correct, which is deterministic
    // and cannot exceed answered.
    return { answered: x.answered || 0, correct: Math.max(x.correct || 0, y.correct || 0) };
  }

  function mergeByDevice(a, b) {
    var out = {};
    var ids = Object.keys(a || {}).concat(Object.keys(b || {}));
    ids.forEach(function (id) {
      if (out[id]) return;
      out[id] = moreAdvanced((a || {})[id], (b || {})[id]);
    });
    return out;
  }

  function mergeByTopic(a, b) {
    var out = {};
    var topics = Object.keys(a || {}).concat(Object.keys(b || {}));
    topics.forEach(function (t) {
      if (out[t]) return;
      out[t] = { byDevice: mergeByDevice(((a || {})[t] || {}).byDevice, ((b || {})[t] || {}).byDevice) };
    });
    return out;
  }

  function sum(byDevice) {
    var total = { answered: 0, correct: 0 };
    Object.keys(byDevice || {}).forEach(function (id) {
      total.answered += byDevice[id].answered || 0;
      total.correct += byDevice[id].correct || 0;
    });
    return total;
  }

  function totals(stats) { return sum((stats || {}).byDevice); }

  function topicTotals(stats, topicId) {
    var t = ((stats || {}).byTopic || {})[topicId];
    return sum(t && t.byDevice);
  }

  // `recent`, `streakByDevice` and `deviceId` are deliberately taken from
  // local and never from remote. `recent` is the rolling window that picks the
  // difficulty band — it describes how you are doing on THIS device right now,
  // and averaging it with another device's would describe nobody. A streak is
  // a property of one continuous sitting for the same reason.
  function mergeStats(local, remote) {
    var out = {};
    Object.keys(local || {}).forEach(function (k) { out[k] = local[k]; });
    out.schema = 2;
    out.byDevice = mergeByDevice((local || {}).byDevice, (remote || {}).byDevice);
    out.byTopic = mergeByTopic((local || {}).byTopic, (remote || {}).byTopic);
    return out;
  }

  global.KinvtMerge = {
    mergeStats: mergeStats,
    totals: totals,
    topicTotals: topicTotals
  };
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/test/merge-stats.test.mjs`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add desktop/ui/merge.js scripts/test/merge-stats.test.mjs
git commit -m "Merge stats as per-device counters, so syncing twice is a no-op"
```

---

### Task 3: `mergeReview` — last-write-wins with tombstones

**Files:**
- Modify: `desktop/ui/merge.js`
- Create: `scripts/test/merge-review.test.mjs`

**Interfaces:**
- Consumes: `KinvtMerge` from Task 2.
- Produces:
  - `KinvtMerge.mergeReview(local: Review, remote: Review) -> Review`
  - `KinvtMerge.pruneTombstones(review: Review, now: number, maxAgeMs?: number) -> Review`
  - `KinvtMerge.TOMBSTONE_MAX_AGE_MS` → `180 * 24 * 60 * 60 * 1000`

  `Review` is `{[questionId]: {misses, streak, updatedAt, updatedBy, retired}}`.

- [ ] **Step 1: Write the failing test**

Create `scripts/test/merge-review.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './harness.mjs';

const M = () => loadModules(['merge.js']).KinvtMerge;

const entry = (o) => ({ misses: 1, streak: 0, updatedAt: 1000, updatedBy: 'dsk-1', retired: false, ...o });

test('an entry only one side has is kept', () => {
  const m = M();
  const out = m.mergeReview({ a: entry() }, { b: entry({ updatedBy: 'and-2' }) });
  assert.deepEqual(Object.keys(out).sort(), ['a', 'b']);
});

test('the later update wins', () => {
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
  // Deterministic by updatedBy, so the two devices cannot disagree.
  assert.deepEqual(m.mergeReview(mine, theirs), m.mergeReview(theirs, mine));
});

test('a retirement survives a stale un-retired copy from the other device', () => {
  const m = M();
  // The nastiest sync bug: delete a key and it simply comes back from the
  // peer. A tombstone is why retirement sticks.
  const retiredHere = { q: entry({ retired: true, updatedAt: 3000 }) };
  const stillActive = { q: entry({ retired: false, updatedAt: 1000, updatedBy: 'and-2' }) };
  assert.equal(m.mergeReview(retiredHere, stillActive).q.retired, true);
  assert.equal(m.mergeReview(stillActive, retiredHere).q.retired, true);
});

test('a genuine later miss revives a retired question', () => {
  const m = M();
  const retired = { q: entry({ retired: true, updatedAt: 1000 }) };
  const missedAgain = { q: entry({ retired: false, misses: 4, updatedAt: 9000, updatedBy: 'and-2' }) };
  const out = m.mergeReview(retired, missedAgain).q;
  assert.equal(out.retired, false);
  assert.equal(out.misses, 4);
});

test('merging review is idempotent', () => {
  const m = M();
  const a = { q: entry({ misses: 2 }) };
  const b = { q: entry({ misses: 7, updatedAt: 4000, updatedBy: 'and-2' }), r: entry() };
  const once = m.mergeReview(a, b);
  assert.deepEqual(m.mergeReview(m.mergeReview(once, b), b), once);
});

test('divergent replicas converge', () => {
  const m = M();
  const desktop = { q1: entry({ updatedAt: 100 }), q2: entry({ updatedAt: 500 }) };
  const phone = { q2: entry({ updatedAt: 900, updatedBy: 'and-2', misses: 3 }), q3: entry({ updatedBy: 'and-2' }) };
  assert.deepEqual(m.mergeReview(desktop, phone), m.mergeReview(phone, desktop));
});

test('pruneTombstones drops only old retired entries', () => {
  const m = M();
  const now = 1_000_000_000_000;
  const old = now - m.TOMBSTONE_MAX_AGE_MS - 1;
  const review = {
    oldRetired: entry({ retired: true, updatedAt: old }),
    freshRetired: entry({ retired: true, updatedAt: now - 1000 }),
    oldActive: entry({ retired: false, updatedAt: old })
  };
  const out = m.pruneTombstones(review, now);
  assert.deepEqual(Object.keys(out).sort(), ['freshRetired', 'oldActive']);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/test/merge-review.test.mjs`
Expected: FAIL — `m.mergeReview is not a function`.

- [ ] **Step 3: Add the review merge**

In `desktop/ui/merge.js`, add before the `global.KinvtMerge` assignment:

```js
  /* ---------- review queue ----------
   * A review entry is a last-write-wins register: whichever device touched it
   * most recently is the one that knows the truth about it.
   *
   * Retirement is a TOMBSTONE rather than a delete. Deleting the key looks
   * correct on one device and then fails completely under sync: the peer still
   * has the entry, so the next exchange puts it straight back and the question
   * can never stay retired. `retired: true` is a fact that merges; absence is
   * not.
   */

  var TOMBSTONE_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

  function laterOf(x, y) {
    var xa = x.updatedAt || 0;
    var ya = y.updatedAt || 0;
    if (ya > xa) return y;
    if (xa > ya) return x;
    // Identical timestamps must resolve the same way on both devices, or they
    // would disagree forever. Comparing the author id is arbitrary but stable.
    return String(y.updatedBy || '') > String(x.updatedBy || '') ? y : x;
  }

  function mergeReview(local, remote) {
    var out = {};
    Object.keys(local || {}).forEach(function (id) { out[id] = local[id]; });
    Object.keys(remote || {}).forEach(function (id) {
      out[id] = out[id] ? laterOf(out[id], remote[id]) : remote[id];
    });
    return out;
  }

  // Tombstones cannot accumulate forever. Six months is far longer than any
  // plausible gap between two devices syncing, so dropping older ones cannot
  // resurrect anything in practice.
  function pruneTombstones(review, now, maxAgeMs) {
    var limit = now - (maxAgeMs || TOMBSTONE_MAX_AGE_MS);
    var out = {};
    Object.keys(review || {}).forEach(function (id) {
      var e = review[id];
      if (e.retired && (e.updatedAt || 0) < limit) return;
      out[id] = e;
    });
    return out;
  }
```

Add to the exported object:

```js
    mergeReview: mergeReview,
    pruneTombstones: pruneTombstones,
    TOMBSTONE_MAX_AGE_MS: TOMBSTONE_MAX_AGE_MS,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/test/merge-review.test.mjs`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add desktop/ui/merge.js scripts/test/merge-review.test.mjs
git commit -m "Merge the review queue last-write-wins, retiring by tombstone"
```

---

### Task 4: `mergeSettings` — only what should travel

**Files:**
- Modify: `desktop/ui/merge.js`
- Create: `scripts/test/merge-settings.test.mjs`

**Interfaces:**
- Consumes: `KinvtMerge` from Tasks 2–3.
- Produces:
  - `KinvtMerge.SYNCED_SETTINGS` → `['topics', 'adaptive', 'perQuiz']`
  - `KinvtMerge.mergeSettings(local: object, remote: object) -> object`

- [ ] **Step 1: Write the failing test**

Create `scripts/test/merge-settings.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './harness.mjs';

const M = () => loadModules(['merge.js']).KinvtMerge;

test('a newer remote replaces the synced settings', () => {
  const m = M();
  const local = { updatedAt: 100, topics: { upsc: true }, adaptive: true, perQuiz: 3 };
  const remote = { updatedAt: 200, topics: { ssc: true }, adaptive: false, perQuiz: 5 };
  const out = m.mergeSettings(local, remote);
  assert.deepEqual(out.topics, { ssc: true });
  assert.equal(out.adaptive, false);
  assert.equal(out.perQuiz, 5);
  assert.equal(out.updatedAt, 200);
});

test('an older remote changes nothing', () => {
  const m = M();
  const local = { updatedAt: 500, topics: { upsc: true }, perQuiz: 3 };
  const remote = { updatedAt: 100, topics: { ssc: true }, perQuiz: 5 };
  assert.deepEqual(m.mergeSettings(local, remote), local);
});

test('device-local settings are never taken from the remote', () => {
  const m = M();
  // A phone reminding you every 30 minutes is not the same request as a
  // desktop doing it, and the two screens are not the same screen.
  const local = { updatedAt: 100, intervalMin: 30, theme: 'dark', glass: 'clear', respectDnd: true, topics: {} };
  const remote = { updatedAt: 999, intervalMin: 120, theme: 'light', glass: 'frosted', respectDnd: false, topics: { upsc: true } };
  const out = m.mergeSettings(local, remote);
  assert.equal(out.intervalMin, 30);
  assert.equal(out.theme, 'dark');
  assert.equal(out.glass, 'clear');
  assert.equal(out.respectDnd, true);
  assert.deepEqual(out.topics, { upsc: true }, 'but topics do travel');
});

test('merging settings is idempotent and commutative on the synced fields', () => {
  const m = M();
  const a = { updatedAt: 100, topics: { upsc: true }, perQuiz: 3 };
  const b = { updatedAt: 200, topics: { ssc: true }, perQuiz: 5 };
  const once = m.mergeSettings(a, b);
  assert.deepEqual(m.mergeSettings(once, b), once);
  assert.equal(m.mergeSettings(a, b).perQuiz, m.mergeSettings(b, a).perQuiz);
});

test('a missing timestamp is treated as oldest', () => {
  const m = M();
  const out = m.mergeSettings({ topics: { a: true } }, { updatedAt: 5, topics: { b: true } });
  assert.deepEqual(out.topics, { b: true });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/test/merge-settings.test.mjs`
Expected: FAIL — `m.mergeSettings is not a function`.

- [ ] **Step 3: Add the settings merge**

In `desktop/ui/merge.js`, add before the exports:

```js
  /* ---------- settings ----------
   * Only some settings belong to the user; the rest belong to the device.
   * Which topics you are studying is a fact about you, and should follow you
   * between devices. How often a device interrupts you, and what it looks
   * like, are facts about that device — a phone asking every 30 minutes is
   * not the same request as a desktop doing it.
   *
   * Whole-object last-write-wins over just the synced fields. Conflicts here
   * are rare and cheap, so anything cleverer would be unearned complexity.
   */
  var SYNCED_SETTINGS = ['topics', 'adaptive', 'perQuiz'];

  function mergeSettings(local, remote) {
    var out = {};
    Object.keys(local || {}).forEach(function (k) { out[k] = local[k]; });
    if (((remote || {}).updatedAt || 0) <= ((local || {}).updatedAt || 0)) return out;

    SYNCED_SETTINGS.forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(remote, k)) out[k] = remote[k];
    });
    out.updatedAt = remote.updatedAt;
    return out;
  }
```

Add to the exports:

```js
    SYNCED_SETTINGS: SYNCED_SETTINGS,
    mergeSettings: mergeSettings,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/test/merge-settings.test.mjs`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add desktop/ui/merge.js scripts/test/merge-settings.test.mjs
git commit -m "Sync topic choices between devices, but not how each one behaves"
```

---

### Task 5: Migrate stored progress to schema 2

**Files:**
- Modify: `desktop/ui/progress.js`
- Create: `scripts/test/migrate.test.mjs`

**Interfaces:**
- Consumes: `KinvtStorage.deviceId` (Task 1), `KinvtMerge.totals`/`topicTotals` (Task 2).
- Produces:
  - `KinvtProgress.migrate(stats: object, deviceId: string, now: number) -> Stats` (pure, exported for testing)
  - `KinvtProgress.migrateReview(review: object, deviceId: string, now: number) -> Review` (pure)
  - `KinvtProgress.getStats()` now always returns schema 2

- [ ] **Step 1: Write the failing test**

Create `scripts/test/migrate.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules, makeLocalStorage } from './harness.mjs';

const MODULES = ['storage.js', 'merge.js', 'progress.js'];
const load = (seed) => loadModules(MODULES, { localStorage: makeLocalStorage(seed) });

test('v1 stats move wholesale onto this device', () => {
  const { KinvtProgress: P, KinvtMerge: M } = load();
  const v1 = {
    answered: 120, correct: 80, streak: 3,
    byTopic: { upsc: { answered: 30, correct: 22 } },
    recent: [1, 0, 1]
  };
  const out = P.migrate(v1, 'dsk-abc123', 1000);
  assert.equal(out.schema, 2);
  assert.deepEqual(out.byDevice['dsk-abc123'], { answered: 120, correct: 80 });
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

test('an empty v1 object migrates to an empty v2 object', () => {
  const { KinvtProgress: P, KinvtMerge: M } = load();
  const out = P.migrate({ answered: 0, correct: 0, streak: 0 }, 'dsk-1', 1000);
  assert.deepEqual(M.totals(out), { answered: 0, correct: 0 });
  assert.equal(out.schema, 2);
});

test('v1 review entries gain a timestamp, an author and a retired flag', () => {
  const { KinvtProgress: P } = load();
  const v1 = { 'up-007': { misses: 3, streak: 0, lastMissedAt: 555 } };
  const out = P.migrateReview(v1, 'dsk-1', 9999);
  assert.equal(out['up-007'].updatedAt, 555, 'lastMissedAt is the best timestamp we have');
  assert.equal(out['up-007'].updatedBy, 'dsk-1');
  assert.equal(out['up-007'].retired, false);
  assert.equal(out['up-007'].misses, 3);
});

test('a review entry with no timestamp falls back to now', () => {
  const { KinvtProgress: P } = load();
  const out = P.migrateReview({ q: { misses: 1, streak: 0 } }, 'dsk-1', 9999);
  assert.equal(out.q.updatedAt, 9999);
});

test('getStats migrates stored v1 data transparently on read', () => {
  const { KinvtProgress: P, KinvtMerge: M } = load({
    'kinvt.stats': JSON.stringify({ answered: 42, correct: 30, streak: 2, byTopic: { ssc: { answered: 10, correct: 7 } } })
  });
  const st = P.getStats();
  assert.equal(st.schema, 2);
  assert.deepEqual(M.totals(st), { answered: 42, correct: 30 });
  assert.deepEqual(M.topicTotals(st, 'ssc'), { answered: 10, correct: 7 });
});

test('the v1 payload is not destroyed until a v2 write succeeds', () => {
  const localStorage = makeLocalStorage({
    'kinvt.stats': JSON.stringify({ answered: 42, correct: 30, streak: 2 })
  });
  const sandbox = loadModules(MODULES, { localStorage });
  sandbox.KinvtProgress.getStats();
  // Reading alone must not have thrown away the only copy of the history.
  const stored = JSON.parse(localStorage.getItem('kinvt.stats'));
  assert.ok(stored, 'stats key still present');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/test/migrate.test.mjs`
Expected: FAIL — `P.migrate is not a function`.

- [ ] **Step 3: Implement migration in `progress.js`**

In `desktop/ui/progress.js`, replace `DEFAULT_STATS` and `getStats`, and add the migration functions:

```js
  var DEFAULT_STATS = {
    schema: 2,
    deviceId: '',
    byDevice: {},
    byTopic: {},
    recent: [],
    streakByDevice: {}
  };

  /* ---------- migration ----------
   * Schema 1 counted answers in flat totals, which cannot be merged between
   * devices without double-counting. Schema 2 attributes every count to the
   * device that earned it.
   *
   * This runs on read and is pure, so it can be tested against real v1 shapes.
   * The stored v1 payload is left in place until a v2 write succeeds: this is
   * the only copy of the user's history, and there is no server to restore it
   * from.
   */
  function migrate(stats, deviceId, now) {
    if (stats && stats.schema === 2) return stats;

    var out = {
      schema: 2,
      deviceId: deviceId,
      byDevice: {},
      byTopic: {},
      recent: Array.isArray(stats && stats.recent) ? stats.recent : [],
      streakByDevice: {}
    };
    out.byDevice[deviceId] = {
      answered: (stats && stats.answered) || 0,
      correct: (stats && stats.correct) || 0
    };
    out.streakByDevice[deviceId] = (stats && stats.streak) || 0;

    var byTopic = (stats && stats.byTopic) || {};
    Object.keys(byTopic).forEach(function (t) {
      out.byTopic[t] = { byDevice: {} };
      out.byTopic[t].byDevice[deviceId] = {
        answered: byTopic[t].answered || 0,
        correct: byTopic[t].correct || 0
      };
    });
    return out;
  }

  function migrateReview(review, deviceId, now) {
    var out = {};
    Object.keys(review || {}).forEach(function (id) {
      var e = review[id];
      if (e && typeof e.updatedAt === 'number') { out[id] = e; return; }
      out[id] = {
        misses: (e && e.misses) || 0,
        streak: (e && e.streak) || 0,
        updatedAt: (e && e.lastMissedAt) || now,
        updatedBy: deviceId,
        retired: false
      };
    });
    return out;
  }

  function thisDevice() { return S.deviceId('dsk'); }

  function getStats() {
    var raw = S.read(S.KEYS.stats, DEFAULT_STATS);
    var st = migrate(raw, thisDevice(), Date.now());
    if (!st.byTopic || typeof st.byTopic !== 'object') st.byTopic = {};
    if (!Array.isArray(st.recent)) st.recent = [];
    if (!st.streakByDevice) st.streakByDevice = {};
    return st;
  }

  function getReview() {
    return migrateReview(S.read(S.KEYS.review, {}), thisDevice(), Date.now());
  }
```

Note: `thisDevice()` uses the `'dsk'` prefix. Sub-project B overrides this for the Android build.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/test/migrate.test.mjs`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add desktop/ui/progress.js scripts/test/migrate.test.mjs
git commit -m "Migrate progress to per-device counters without losing history"
```

---

### Task 6: Record answers and retirement in the new shape

**Files:**
- Modify: `desktop/ui/progress.js` (`recordAnswer`, `recordResult`, `topicAccuracy`, `recentAccuracy`, `topicBreakdown`, `pickReviewQuestions`, `reviewCount`)
- Create: `scripts/test/progress-v2.test.mjs`

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces: the same public `KinvtProgress` surface as before, now operating on schema 2. `reviewCount()` and `pickReviewQuestions()` exclude retired entries.

- [ ] **Step 1: Write the failing test**

Create `scripts/test/progress-v2.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules, makeLocalStorage } from './harness.mjs';

const MODULES = ['storage.js', 'merge.js', 'progress.js'];
const load = (seed) => loadModules(MODULES, { localStorage: makeLocalStorage(seed) });
const q = (id, category) => ({ id, category });

test('answers accumulate against this device', () => {
  const { KinvtProgress: P, KinvtMerge: M, KinvtStorage: S } = load();
  const me = S.deviceId('dsk');
  P.recordAnswer(q('up-1', 'upsc'), true);
  P.recordAnswer(q('up-2', 'upsc'), false);
  const st = P.getStats();
  assert.deepEqual(st.byDevice[me], { answered: 2, correct: 1 });
  assert.deepEqual(M.totals(st), { answered: 2, correct: 1 });
  assert.deepEqual(M.topicTotals(st, 'upsc'), { answered: 2, correct: 1 });
});

test('totals include another device that has been synced in', () => {
  const { KinvtProgress: P, KinvtMerge: M } = load({
    'kinvt.stats': JSON.stringify({
      schema: 2, deviceId: 'dsk-1',
      byDevice: { 'dsk-1': { answered: 10, correct: 6 }, 'and-2': { answered: 5, correct: 5 } },
      byTopic: {}, recent: [], streakByDevice: {}
    })
  });
  assert.deepEqual(M.totals(P.getStats()), { answered: 15, correct: 11 });
});

test('retirement writes a tombstone rather than deleting', () => {
  const { KinvtProgress: P } = load();
  P.recordAnswer(q('up-7', 'upsc'), false);
  P.recordAnswer(q('up-7', 'upsc'), true);
  P.recordAnswer(q('up-7', 'upsc'), true);   // second correct retires it
  const review = P.getReview();
  assert.ok(review['up-7'], 'the entry must still exist as a tombstone');
  assert.equal(review['up-7'].retired, true);
  assert.equal(P.reviewCount(), 0, 'but it does not count as due');
});

test('a retired question is never picked for review', () => {
  const { KinvtProgress: P } = load({
    'kinvt.review': JSON.stringify({
      dead: { misses: 9, streak: 0, updatedAt: 1, updatedBy: 'dsk-1', retired: true },
      live: { misses: 1, streak: 0, updatedAt: 1, updatedBy: 'dsk-1', retired: false }
    })
  });
  const picked = P.pickReviewQuestions([q('dead', 'upsc'), q('live', 'upsc')], 5);
  assert.deepEqual(picked.map(x => x.id), ['live']);
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

test('every review write stamps who and when', () => {
  const { KinvtProgress: P, KinvtStorage: S } = load();
  const me = S.deviceId('dsk');
  P.recordAnswer(q('up-9', 'upsc'), false);
  const e = P.getReview()['up-9'];
  assert.equal(e.updatedBy, me);
  assert.ok(e.updatedAt > 0);
});

test('topicAccuracy and topicBreakdown read across all devices', () => {
  const { KinvtProgress: P } = load({
    'kinvt.stats': JSON.stringify({
      schema: 2, deviceId: 'dsk-1',
      byDevice: {},
      byTopic: {
        weak: { byDevice: { 'dsk-1': { answered: 5, correct: 1 }, 'and-2': { answered: 5, correct: 1 } } },
        strong: { byDevice: { 'dsk-1': { answered: 10, correct: 9 } } }
      },
      recent: [], streakByDevice: {}
    })
  });
  assert.equal(P.topicAccuracy('weak'), 0.2);
  assert.equal(P.topicAccuracy('strong'), 0.9);
  assert.deepEqual(P.topicBreakdown().map(r => r.id), ['weak', 'strong']);
});

test('recordResult keeps a per-device streak', () => {
  const { KinvtProgress: P, KinvtStorage: S } = load();
  const me = S.deviceId('dsk');
  P.recordResult(3, 3);
  assert.equal(P.getStats().streakByDevice[me], 1);
  P.recordResult(1, 3);
  assert.equal(P.getStats().streakByDevice[me], 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/test/progress-v2.test.mjs`
Expected: FAIL — counters still written in the v1 flat shape.

- [ ] **Step 3: Rewrite the recording functions**

In `desktop/ui/progress.js`, replace `recordResult`, `recordAnswer`, `pickReviewQuestions`, `reviewCount`, `topicAccuracy`, `recentAccuracy` and `topicBreakdown`:

```js
  function recordResult(correct, total) {
    var st = getStats();
    var me = thisDevice();
    st.streakByDevice[me] = (total > 0 && correct === total)
      ? (st.streakByDevice[me] || 0) + 1
      : 0;
    setStats(st);
    return st;
  }

  function recordAnswer(question, wasCorrect) {
    if (!question || !question.id) return;
    var me = thisDevice();
    var now = Date.now();

    var st = getStats();
    var mine = st.byDevice[me] || { answered: 0, correct: 0 };
    mine.answered += 1;
    if (wasCorrect) mine.correct += 1;
    st.byDevice[me] = mine;

    var cat = question.category || 'unknown';
    var topic = st.byTopic[cat] || { byDevice: {} };
    var t = topic.byDevice[me] || { answered: 0, correct: 0 };
    t.answered += 1;
    if (wasCorrect) t.correct += 1;
    topic.byDevice[me] = t;
    st.byTopic[cat] = topic;

    st.recent.push(wasCorrect ? 1 : 0);
    if (st.recent.length > RECENT_MAX) st.recent = st.recent.slice(-RECENT_MAX);
    setStats(st);

    // ---- spaced repetition ----
    var review = getReview();
    var entry = review[question.id];
    var active = entry && !entry.retired ? entry : null;

    if (wasCorrect) {
      if (!active) return;                      // never missed, or already retired
      var streak = (active.streak || 0) + 1;
      review[question.id] = {
        misses: active.misses || 0,
        streak: streak,
        // Retiring writes a tombstone. Deleting the key would look right here
        // and fail under sync: the peer still has the entry and would put it
        // straight back on the next exchange.
        retired: streak >= RETIRE_AFTER,
        updatedAt: now,
        updatedBy: me
      };
    } else {
      review[question.id] = {
        misses: (entry ? entry.misses || 0 : 0) + 1,
        streak: 0,
        retired: false,                          // a fresh miss revives it
        updatedAt: now,
        updatedBy: me
      };
    }
    setReview(review);
  }

  function activeReview() {
    var review = getReview();
    var out = {};
    Object.keys(review).forEach(function (id) {
      if (!review[id].retired) out[id] = review[id];
    });
    return out;
  }

  function reviewCount() { return Object.keys(activeReview()).length; }

  function pickReviewQuestions(bank, limit) {
    var review = activeReview();
    return bank
      .filter(function (q) { return review[q.id]; })
      .sort(function (a, b) { return (review[b.id].misses || 0) - (review[a.id].misses || 0); })
      .slice(0, Math.max(0, limit));
  }

  function topicAccuracy(topicId) {
    var t = global.KinvtMerge.topicTotals(getStats(), topicId);
    if (t.answered < MIN_ATTEMPTS) return null;
    return t.correct / t.answered;
  }

  function recentAccuracy() {
    var r = getStats().recent;
    if (r.length < MIN_ATTEMPTS) return null;
    return r.reduce(function (a, b) { return a + b; }, 0) / r.length;
  }

  function topicBreakdown() {
    var st = getStats();
    return Object.keys(st.byTopic).map(function (id) {
      var t = global.KinvtMerge.topicTotals(st, id);
      return {
        id: id,
        answered: t.answered,
        correct: t.correct,
        accuracy: t.answered ? t.correct / t.answered : null
      };
    }).sort(function (a, b) {
      if (a.accuracy === null && b.accuracy === null) return a.id < b.id ? -1 : 1;
      if (a.accuracy === null) return 1;
      if (b.accuracy === null) return -1;
      return a.accuracy - b.accuracy;
    });
  }
```

Also export `migrate`, `migrateReview` and `getReview` on `KinvtProgress`.

- [ ] **Step 4: Run the full suite**

Run: `node --test scripts/test/`
Expected: PASS. The pre-existing `progress.test.mjs` from the app-improvements plan asserts the v1 shape and **will fail** — update those assertions to read totals through `KinvtMerge.totals` rather than `stats.answered`. Do not delete the tests; the behaviour they check is still required.

- [ ] **Step 5: Commit**

```bash
git add desktop/ui/progress.js scripts/test/progress-v2.test.mjs scripts/test/progress.test.mjs
git commit -m "Record answers per device and retire questions with a tombstone"
```

---

### Task 7: Replace the summing import with the merge

This is where the original bug dies.

**Files:**
- Modify: `desktop/ui/progress.js` (`exportPayload`, `importPayload`)
- Create: `scripts/test/backup-merge.test.mjs`

**Interfaces:**
- Consumes: `KinvtMerge.{mergeStats, mergeReview, mergeSettings}`.
- Produces:
  - `exportPayload() -> {version: 2, exportedAt, deviceId, settings, stats, review}`
  - `importPayload(payload) -> {ok: true} | {ok: false, error: string}` — now idempotent.

- [ ] **Step 1: Write the failing test**

Create `scripts/test/backup-merge.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules, makeLocalStorage } from './harness.mjs';

const MODULES = ['storage.js', 'merge.js', 'progress.js'];
const load = (seed) => loadModules(MODULES, { localStorage: makeLocalStorage(seed) });
const q = (id, category) => ({ id, category });

const remote = () => ({
  version: 2,
  exportedAt: new Date(2026, 0, 1).toISOString(),
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
  P.recordAnswer(q('up-1', 'upsc'), true);      // 1 local answer

  assert.deepEqual(P.importPayload(remote()), { ok: true });
  const after1 = M.totals(P.getStats());

  P.importPayload(remote());
  P.importPayload(remote());
  const after3 = M.totals(P.getStats());

  // This is the whole point: the old summing merge gave 61/37 here.
  assert.deepEqual(after3, after1);
  assert.deepEqual(after1, { answered: 21, correct: 13 });
});

test('local progress survives an import', () => {
  const { KinvtProgress: P, KinvtMerge: M, KinvtStorage: S } = load();
  const me = S.deviceId('dsk');
  P.recordAnswer(q('up-1', 'upsc'), true);
  P.importPayload(remote());
  assert.deepEqual(P.getStats().byDevice[me], { answered: 1, correct: 1 });
});

test('review entries from both sides are kept', () => {
  const { KinvtProgress: P } = load();
  P.recordAnswer(q('up-9', 'upsc'), false);
  P.importPayload(remote());
  assert.equal(P.reviewCount(), 2);
});

test('a v1 backup is still accepted and migrated', () => {
  const { KinvtProgress: P, KinvtMerge: M } = load();
  const res = P.importPayload({
    version: 1,
    settings: { intervalMin: 45 },
    stats: { answered: 10, correct: 6, streak: 1, byTopic: { upsc: { answered: 10, correct: 6 } } },
    review: { 'up-3': { misses: 1, streak: 0, lastMissedAt: 5 } }
  });
  assert.deepEqual(res, { ok: true });
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

test('exportPayload round-trips through importPayload unchanged', () => {
  const { KinvtProgress: P, KinvtMerge: M } = load();
  P.recordAnswer(q('up-1', 'upsc'), true);
  P.recordAnswer(q('up-2', 'upsc'), false);
  const snapshot = JSON.parse(JSON.stringify(P.exportPayload()));
  const before = M.totals(P.getStats());
  P.importPayload(snapshot);
  assert.deepEqual(M.totals(P.getStats()), before, 'importing your own export is a no-op');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/test/backup-merge.test.mjs`
Expected: FAIL — totals inflate on repeated import.

- [ ] **Step 3: Rewrite export and import**

In `desktop/ui/progress.js`, replace both functions:

```js
  /* ---------- backup and sync ----------
   * Import MERGES, and merging is idempotent: importing the same payload ten
   * times leaves exactly what importing it once did.
   *
   * The previous version added the two sides' counters together, which was
   * wrong even for backups — restoring the same file twice doubled the
   * answered count — and would be fatal for sync, which repeats constantly.
   */

  function exportPayload() {
    return {
      version: 2,
      exportedAt: new Date().toISOString(),
      deviceId: thisDevice(),
      settings: S.read(S.KEYS.settings, {}),
      stats: getStats(),
      review: getReview()
    };
  }

  function importPayload(payload) {
    if (!payload || (payload.version !== 1 && payload.version !== 2)) {
      return { ok: false, error: 'unrecognised backup format' };
    }
    if (!payload.stats || typeof payload.stats !== 'object') {
      return { ok: false, error: 'backup contains no stats' };
    }

    var now = Date.now();
    var author = payload.deviceId || 'imported';

    // A v1 payload predates device attribution, so everything in it is
    // credited to the device that wrote it.
    var incomingStats = migrate(payload.stats, author, now);
    var incomingReview = migrateReview(payload.review || {}, author, now);

    var M = global.KinvtMerge;
    setStats(M.mergeStats(getStats(), incomingStats));
    setReview(M.pruneTombstones(M.mergeReview(getReview(), incomingReview), now));

    if (payload.settings && typeof payload.settings === 'object') {
      S.write(S.KEYS.settings, M.mergeSettings(S.read(S.KEYS.settings, {}), payload.settings));
    }
    return { ok: true };
  }
```

- [ ] **Step 4: Run the full suite**

Run: `node --test scripts/test/`
Expected: PASS. The app-improvements `progress.test.mjs` case asserting that import *sums* is now wrong by design — replace it with the idempotence assertion and note why in the test name.

- [ ] **Step 5: Commit**

```bash
git add desktop/ui/progress.js scripts/test/backup-merge.test.mjs scripts/test/progress.test.mjs
git commit -m "Merge backups instead of summing them, so importing twice is safe"
```

---

### Task 8: Load the new module everywhere, and regenerate the feed

**Files:**
- Modify: `desktop/ui/index.html`, `desktop/ui/settings.html`, `desktop/ui/_preview.html`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing new.

- [ ] **Step 1: Add `merge.js` to the script order**

`merge.js` has no dependencies and `progress.js` uses it, so it loads first. In all three HTML files the block becomes:

```html
  <script src="merge.js"></script>
  <script src="storage.js"></script>
  <script src="progress.js"></script>
  <script src="selection.js"></script>
  <script src="quiz-engine.js"></script>
```

(`index.html` and `_preview.html` keep `ui-core.js` before these and `app.js` after; `settings.html` keeps `settings.js` after.)

- [ ] **Step 2: Fail CI when a UI module is not loaded**

Create `scripts/check-ui-scripts.mjs`:

```js
// Every module in desktop/ui must be loaded by every page that needs it.
// A module added to the folder but not to the <script> list fails silently:
// the page loads, the global is simply undefined, and the first call throws
// at runtime instead of at build time.
import fs from 'node:fs';
import path from 'node:path';

const UI = path.join('desktop', 'ui');
const REQUIRED = ['merge.js', 'storage.js', 'progress.js', 'selection.js', 'quiz-engine.js'];
const PAGES = ['index.html', 'settings.html', '_preview.html'];

const errors = [];
for (const page of PAGES) {
  const html = fs.readFileSync(path.join(UI, page), 'utf8');
  const order = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
  for (const mod of REQUIRED) {
    if (!order.includes(mod)) { errors.push(`${page}: does not load ${mod}`); continue; }
  }
  // progress.js calls KinvtMerge and KinvtStorage at call time, so both must
  // have been evaluated before it.
  const at = (m) => order.indexOf(m);
  if (at('merge.js') > at('progress.js')) errors.push(`${page}: merge.js must load before progress.js`);
  if (at('storage.js') > at('progress.js')) errors.push(`${page}: storage.js must load before progress.js`);
  if (at('progress.js') > at('selection.js')) errors.push(`${page}: progress.js must load before selection.js`);
}

if (errors.length) {
  console.error(`\n✗ ${errors.length} problem(s):`);
  errors.forEach(e => console.error('  - ' + e));
  process.exit(1);
}
console.log(`✓ ${PAGES.length} pages load all ${REQUIRED.length} UI modules in a valid order`);
```

- [ ] **Step 3: Run it**

Run: `node scripts/check-ui-scripts.mjs`
Expected: `✓ 3 pages load all 5 UI modules in a valid order`.

Then deliberately break it to prove it works: remove the `merge.js` line from `settings.html`, re-run, confirm it exits non-zero, and restore the line.

- [ ] **Step 4: Add it to CI**

In `.github/workflows/ci.yml`, after the `Library wiring` step:

```yaml
      - name: UI module wiring
        run: node scripts/check-ui-scripts.mjs

      - name: Unit tests
        run: node --test scripts/test/
```

- [ ] **Step 5: Regenerate the feed and verify everything**

```bash
node scripts/sync-feed.mjs
node scripts/check-library.mjs
node scripts/check-ui-scripts.mjs
node --test scripts/test/
```

Expected: all four pass.

- [ ] **Step 6: Verify the app still runs**

```bash
node scripts/serve-ui.js
```

Open `http://localhost:8792/_preview.html`, confirm a card renders and answering advances it. Then in the console check the new shape is live:

```js
JSON.parse(localStorage.getItem('kinvt.stats')).schema   // 2
```

- [ ] **Step 7: Commit**

```bash
git add desktop/ui/index.html desktop/ui/settings.html desktop/ui/_preview.html scripts/check-ui-scripts.mjs .github/workflows/ci.yml data library.json
git commit -m "Load merge.js everywhere, and fail CI if a module is unwired"
```

---

## Self-review

**Spec coverage:**

| Spec section (sub-project A) | Task |
|---|---|
| Device identity | 1 |
| Stats as per-device counters, merge rule | 2 |
| `recent`/`streak` stay local | 2 (merge), 6 (recording) |
| Review LWW + tombstones + pruning | 3, 6 |
| Settings synced/local split | 4 |
| Migration from v1 | 5 |
| Fixing the non-idempotent import | 7 |
| Merge lives in shared `ui/`, pure, unit-tested | 2, 3, 4 |

**Type consistency:** `Stats` uses `byDevice`/`byTopic[t].byDevice` in Tasks 2, 5, 6 and 7. `Review` entries carry `misses`/`streak`/`updatedAt`/`updatedBy`/`retired` in Tasks 3, 5, 6 and 7. `KinvtMerge.totals`/`topicTotals` defined in Task 2 are consumed in 5, 6 and 7. `thisDevice()` is introduced in Task 5 and used in 6 and 7.

**Known ordering constraint:** Task 2 must precede Task 5 (migration returns the shape merge expects). Task 6 must precede Task 7 (import merges what recording writes).

**Deliberate breakage:** Tasks 6 and 7 invalidate assertions in the app-improvements `progress.test.mjs`, which asserts the v1 flat shape and summing import. Both tasks say to update rather than delete them — the behaviours are still required, only their expected shape changed.

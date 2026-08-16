# Kinvt-study App Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the quiz app select questions adaptively, show the user their progress, respect do-not-disturb, update itself, back up its data, and run under CI.

**Architecture:** `desktop/ui/quiz-engine.js` splits into four browser-global modules (`storage` → `progress` → `selection` → `quiz-engine`), each loadable both by the webview via `<script>` and by a Node test harness via `vm`. Rust gains four thin commands (open a URL, query DND, read/write a backup file) and keeps owning nothing but shell plumbing.

**Tech Stack:** Vanilla ES5-style IIFE modules (no build step), Tauri 2 + Rust, `node --test` for unit tests, GitHub Actions.

## Global Constraints

- **No build step for `desktop/ui/`.** Modules stay IIFEs over a `global` param, loaded by `<script>` tags. Never introduce `import`/`export` into `desktop/ui/*.js`.
- **Module global boundary:** every module ends with `})(typeof window !== 'undefined' ? window : globalThis);` so the Node test harness can load it.
- **`KinvtQuiz` stays the only public surface** consumed by `app.js`, `settings.js`, `ui-core.js`. New modules expose `KinvtStorage`, `KinvtProgress`, `KinvtSelection` for tests and internal use only.
- **Script tag order** wherever UI modules load: `storage.js`, `progress.js`, `selection.js`, `quiz-engine.js`. Files needing it: `desktop/ui/index.html`, `desktop/ui/settings.html`, `desktop/ui/_preview.html`.
- **Rust owns no quiz logic.** New commands are I/O and OS queries only.
- **Non-Windows must compile.** Every Win32 call is `#[cfg(windows)]` with a `#[cfg(not(windows))]` counterpart.
- **CSP is `default-src 'self'`.** External URLs never open in the webview; they go through the `open_url` command.
- Existing localStorage keys are unchanged: `kinvt.settings`, `kinvt.stats`, `kinvt.review`, `kinvt.remoteLibrary`, `kinvt.lastSyncAt`.
- Settings defaults added by this plan: `adaptive: true`, `respectDnd: true`.
- Tests run from the repo root with `node --test scripts/test/`.

---

### Task 1: Test harness and `storage.js`

Extracts the localStorage layer from `quiz-engine.js` with no behaviour change, and builds the harness every later test depends on.

**Files:**
- Create: `scripts/test/harness.mjs`
- Create: `desktop/ui/storage.js`
- Create: `scripts/test/storage.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `harness.mjs`: `makeLocalStorage(seed?: object) -> LocalStorageStub` (stub has `getItem`, `setItem`, `removeItem`, `clear`, `_dump()`); `loadModules(files: string[], opts?: {localStorage?}) -> sandbox` where `files` are paths relative to `desktop/ui/`.
  - `KinvtStorage.KEYS` → `{settings, stats, review, remote, syncAt, snoozeUntil}` (string values `kinvt.settings`, `kinvt.stats`, `kinvt.review`, `kinvt.remoteLibrary`, `kinvt.lastSyncAt`, `kinvt.snoozeUntil`).
  - `KinvtStorage.read(key: string, fallback: object) -> object`
  - `KinvtStorage.write(key: string, value: any) -> boolean`
  - `KinvtStorage.readNumber(key: string) -> number`
  - `KinvtStorage.writeNumber(key: string, n: number) -> void`
  - `KinvtStorage.clone(v: any) -> any`

- [ ] **Step 1: Write the harness**

Create `scripts/test/harness.mjs`:

```js
// Loads desktop/ui modules into a sandbox so their pure logic can be tested.
//
// The UI modules are IIFEs that attach to a `global` rather than ES modules,
// because the webview loads them with plain <script> tags and has no build
// step. `vm` is what lets Node load them anyway without changing that.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const UI_DIR = path.join(process.cwd(), 'desktop', 'ui');

export function makeLocalStorage(seed = {}) {
  const store = new Map(Object.entries(seed).map(([k, v]) => [k, String(v)]));
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => store.clear(),
    _dump: () => Object.fromEntries(store)
  };
}

export function loadModules(files, { localStorage = makeLocalStorage() } = {}) {
  const sandbox = { localStorage, console };
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

Create `scripts/test/storage.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules, makeLocalStorage } from './harness.mjs';

function load(seed) {
  const localStorage = makeLocalStorage(seed);
  const sandbox = loadModules(['storage.js'], { localStorage });
  return { S: sandbox.KinvtStorage, localStorage };
}

test('read returns a copy of the fallback when the key is absent', () => {
  const { S } = load();
  const fallback = { a: 1, nested: { b: 2 } };
  const got = S.read('missing', fallback);
  assert.deepEqual(got, fallback);
  got.a = 99;
  assert.equal(fallback.a, 1, 'mutating the result must not touch the fallback');
});

test('read merges stored values over the fallback', () => {
  const { S } = load({ 'kinvt.settings': JSON.stringify({ a: 5 }) });
  assert.deepEqual(S.read('kinvt.settings', { a: 1, b: 2 }), { a: 5, b: 2 });
});

test('read falls back when the stored value is corrupt', () => {
  const { S } = load({ 'kinvt.stats': 'not json{' });
  assert.deepEqual(S.read('kinvt.stats', { answered: 0 }), { answered: 0 });
});

test('write persists JSON and reports success', () => {
  const { S, localStorage } = load();
  assert.equal(S.write('kinvt.stats', { answered: 3 }), true);
  assert.equal(localStorage.getItem('kinvt.stats'), '{"answered":3}');
});

test('readNumber returns 0 for absent or unparseable values', () => {
  const { S } = load({ 'kinvt.lastSyncAt': 'abc' });
  assert.equal(S.readNumber('kinvt.lastSyncAt'), 0);
  assert.equal(S.readNumber('nope'), 0);
});

test('writeNumber round-trips through readNumber', () => {
  const { S } = load();
  S.writeNumber('kinvt.lastSyncAt', 1755300000000);
  assert.equal(S.readNumber('kinvt.lastSyncAt'), 1755300000000);
});

test('KEYS match the keys already in production storage', () => {
  const { S } = load();
  assert.equal(S.KEYS.settings, 'kinvt.settings');
  assert.equal(S.KEYS.stats, 'kinvt.stats');
  assert.equal(S.KEYS.review, 'kinvt.review');
  assert.equal(S.KEYS.remote, 'kinvt.remoteLibrary');
  assert.equal(S.KEYS.syncAt, 'kinvt.lastSyncAt');
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test scripts/test/storage.test.mjs`
Expected: FAIL — `ENOENT` on `desktop/ui/storage.js`.

- [ ] **Step 4: Write `storage.js`**

Create `desktop/ui/storage.js`:

```js
/*
 * Kinvt-study — the one place that touches localStorage.
 *
 * Split out of quiz-engine.js so that stats, spaced repetition and adaptive
 * selection can each be read and tested without dragging the whole engine
 * (and its fetches) along with them.
 *
 * `read` merges stored values over a fallback, so a stored object written by
 * an older version is transparently topped up with any newly added fields —
 * that is what makes new stats fields work without a migration step.
 */
(function (global) {
  'use strict';

  var KEYS = {
    settings: 'kinvt.settings',
    stats: 'kinvt.stats',
    review: 'kinvt.review',
    remote: 'kinvt.remoteLibrary',
    syncAt: 'kinvt.lastSyncAt',
    snoozeUntil: 'kinvt.snoozeUntil'
  };

  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  function read(key, fallback) {
    try {
      var raw = global.localStorage.getItem(key);
      if (!raw) return clone(fallback);
      return Object.assign(clone(fallback), JSON.parse(raw));
    } catch (e) {
      // Corrupt or unreadable storage must never take the app down; the
      // fallback is always a usable value.
      return clone(fallback);
    }
  }

  function write(key, value) {
    try {
      global.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  function readNumber(key) {
    try {
      return parseInt(global.localStorage.getItem(key) || '0', 10) || 0;
    } catch (e) {
      return 0;
    }
  }

  function writeNumber(key, n) {
    try { global.localStorage.setItem(key, String(n)); } catch (e) { /* noop */ }
  }

  global.KinvtStorage = {
    KEYS: KEYS,
    read: read,
    write: write,
    readNumber: readNumber,
    writeNumber: writeNumber,
    clone: clone
  };
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test scripts/test/storage.test.mjs`
Expected: PASS — 7 tests.

- [ ] **Step 6: Commit**

```bash
git add scripts/test/harness.mjs scripts/test/storage.test.mjs desktop/ui/storage.js
git commit -m "Extract the localStorage layer, with a vm-based test harness"
```

---

### Task 2: `progress.js` — per-topic stats, review queue, export/import

**Files:**
- Create: `desktop/ui/progress.js`
- Create: `scripts/test/progress.test.mjs`

**Interfaces:**
- Consumes: `KinvtStorage.{KEYS, read, write, clone}` from Task 1.
- Produces (`global.KinvtProgress`):
  - `DEFAULT_STATS` → `{answered: 0, correct: 0, streak: 0, byTopic: {}, recent: []}`
  - `getStats() -> stats`
  - `recordResult(correct: number, total: number) -> stats` (overall counters + streak; unchanged semantics)
  - `recordAnswer(question: object, wasCorrect: boolean) -> void` (per-topic counters, `recent` window, review queue)
  - `resetStats() -> void`
  - `getReview() -> {[id]: {misses, streak, lastMissedAt}}`
  - `reviewCount() -> number`
  - `pickReviewQuestions(bank: object[], limit: number) -> object[]`
  - `topicAccuracy(topicId: string) -> number|null` (null below 5 attempts)
  - `recentAccuracy() -> number|null` (null below 5 recorded answers)
  - `topicBreakdown() -> {id, answered, correct, accuracy}[]` sorted weakest-first, unattempted last
  - `exportPayload() -> {version: 1, exportedAt, settings, stats, review}`
  - `importPayload(payload: object) -> {ok: true} | {ok: false, error: string}`

- [ ] **Step 1: Write the failing test**

Create `scripts/test/progress.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules, makeLocalStorage } from './harness.mjs';

function load(seed) {
  const localStorage = makeLocalStorage(seed);
  const sandbox = loadModules(['storage.js', 'progress.js'], { localStorage });
  return { P: sandbox.KinvtProgress, localStorage };
}

const q = (id, category, extra = {}) => ({ id, category, ...extra });

test('recordAnswer accumulates per-topic counters', () => {
  const { P } = load();
  P.recordAnswer(q('up-001', 'upsc'), true);
  P.recordAnswer(q('up-002', 'upsc'), false);
  P.recordAnswer(q('ss-001', 'ssc'), true);
  const st = P.getStats();
  assert.deepEqual(st.byTopic.upsc, { answered: 2, correct: 1 });
  assert.deepEqual(st.byTopic.ssc, { answered: 1, correct: 1 });
});

test('recent is capped at 30 entries, newest last', () => {
  const { P } = load();
  for (let i = 0; i < 35; i++) P.recordAnswer(q(`x-${i}`, 'upsc'), i % 2 === 0);
  const st = P.getStats();
  assert.equal(st.recent.length, 30);
  assert.equal(st.recent[29], 34 % 2 === 0 ? 1 : 0);
});

test('topicAccuracy is null until 5 attempts, then a ratio', () => {
  const { P } = load();
  for (let i = 0; i < 4; i++) P.recordAnswer(q(`a-${i}`, 'upsc'), true);
  assert.equal(P.topicAccuracy('upsc'), null, 'four attempts is not enough signal');
  P.recordAnswer(q('a-4', 'upsc'), false);
  assert.equal(P.topicAccuracy('upsc'), 0.8);
  assert.equal(P.topicAccuracy('never-seen'), null);
});

test('recentAccuracy is null until 5 answers', () => {
  const { P } = load();
  for (let i = 0; i < 4; i++) P.recordAnswer(q(`b-${i}`, 'ssc'), true);
  assert.equal(P.recentAccuracy(), null);
  P.recordAnswer(q('b-4', 'ssc'), false);
  assert.equal(P.recentAccuracy(), 0.8);
});

test('topicBreakdown sorts weakest first and puts unattempted last', () => {
  const { P } = load({
    'kinvt.stats': JSON.stringify({
      answered: 0, correct: 0, streak: 0, recent: [],
      byTopic: {
        strong: { answered: 10, correct: 9 },
        weak: { answered: 10, correct: 2 },
        untouched: { answered: 0, correct: 0 }
      }
    })
  });
  const rows = P.topicBreakdown();
  assert.deepEqual(rows.map(r => r.id), ['weak', 'strong', 'untouched']);
  assert.equal(rows[0].accuracy, 0.2);
  assert.equal(rows[2].accuracy, null);
});

test('a missed question enters the review queue and retires after two correct', () => {
  const { P } = load();
  P.recordAnswer(q('up-007', 'upsc'), false);
  assert.equal(P.reviewCount(), 1);
  P.recordAnswer(q('up-007', 'upsc'), true);
  assert.equal(P.reviewCount(), 1, 'one correct could be a lucky guess');
  P.recordAnswer(q('up-007', 'upsc'), true);
  assert.equal(P.reviewCount(), 0);
});

test('a miss resets review progress', () => {
  const { P } = load();
  P.recordAnswer(q('up-008', 'upsc'), false);
  P.recordAnswer(q('up-008', 'upsc'), true);
  P.recordAnswer(q('up-008', 'upsc'), false);
  P.recordAnswer(q('up-008', 'upsc'), true);
  assert.equal(P.reviewCount(), 1, 'streak restarted, so it is not retired yet');
});

test('pickReviewQuestions returns most-missed first, limited', () => {
  const { P } = load();
  P.recordAnswer(q('a', 'upsc'), false);
  P.recordAnswer(q('b', 'upsc'), false);
  P.recordAnswer(q('b', 'upsc'), false);
  const bank = [q('a', 'upsc'), q('b', 'upsc'), q('c', 'upsc')];
  assert.deepEqual(P.pickReviewQuestions(bank, 2).map(x => x.id), ['b', 'a']);
  assert.deepEqual(P.pickReviewQuestions(bank, 1).map(x => x.id), ['b']);
});

test('recordResult keeps overall counters and perfect-run streak', () => {
  const { P } = load();
  P.recordResult(3, 3);
  assert.equal(P.getStats().streak, 1);
  P.recordResult(2, 3);
  const st = P.getStats();
  assert.equal(st.streak, 0, 'an imperfect run breaks the streak');
  assert.equal(st.answered, 6);
  assert.equal(st.correct, 5);
});

test('exportPayload carries version, settings, stats and review', () => {
  const { P } = load({ 'kinvt.settings': JSON.stringify({ intervalMin: 45 }) });
  P.recordAnswer(q('up-001', 'upsc'), false);
  const out = P.exportPayload();
  assert.equal(out.version, 1);
  assert.equal(out.settings.intervalMin, 45);
  assert.equal(Object.keys(out.review).length, 1);
  assert.ok(Date.parse(out.exportedAt) > 0);
});

test('importPayload rejects an unrecognised format without changing anything', () => {
  const { P } = load();
  P.recordAnswer(q('up-001', 'upsc'), false);
  const before = P.getStats();
  assert.deepEqual(P.importPayload({ version: 99 }), { ok: false, error: 'unrecognised backup format' });
  assert.deepEqual(P.importPayload(null), { ok: false, error: 'unrecognised backup format' });
  assert.deepEqual(P.getStats(), before);
});

test('importPayload merges rather than clobbering', () => {
  const { P } = load();
  P.recordAnswer(q('local-1', 'upsc'), false);   // local miss
  const res = P.importPayload({
    version: 1,
    settings: { intervalMin: 90 },
    stats: {
      answered: 10, correct: 6, streak: 4, recent: [1, 1],
      byTopic: { upsc: { answered: 4, correct: 3 } }
    },
    review: { 'imported-1': { misses: 3, streak: 0, lastMissedAt: 1 } }
  });
  assert.deepEqual(res, { ok: true });
  const st = P.getStats();
  assert.equal(st.answered, 10, 'summed with local 0');
  assert.equal(st.byTopic.upsc.answered, 5, 'imported 4 + local 1');
  assert.equal(st.streak, 4, 'the better streak survives');
  assert.equal(P.reviewCount(), 2, 'both review entries kept');
});

test('importPayload keeps the higher miss count when both sides have a question', () => {
  const { P } = load();
  P.recordAnswer(q('shared', 'upsc'), false);   // local misses = 1
  P.importPayload({
    version: 1, settings: {}, stats: { answered: 0, correct: 0, streak: 0, byTopic: {}, recent: [] },
    review: { shared: { misses: 7, streak: 0, lastMissedAt: 1 } }
  });
  assert.equal(P.getReview().shared.misses, 7);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/test/progress.test.mjs`
Expected: FAIL — `ENOENT` on `desktop/ui/progress.js`.

- [ ] **Step 3: Write `progress.js`**

Create `desktop/ui/progress.js`:

```js
/*
 * Kinvt-study — everything the app remembers about how you are doing.
 *
 * Two accumulators, deliberately separate:
 *   recordResult  — per-popup totals and the perfect-run streak (onFinish)
 *   recordAnswer  — per-question: topic counters, the rolling window that
 *                   drives difficulty, and the spaced-repetition queue
 *
 * They count different things and never double-count a field.
 *
 * Retirement from review is by consecutive correct answers, not by a timer:
 * getting it right twice is evidence you know it; once could be a guess
 * between four options.
 */
(function (global) {
  'use strict';

  var S = global.KinvtStorage;

  var RETIRE_AFTER = 2;     // consecutive correct answers to drop a question
  var RECENT_MAX = 30;      // rolling window that decides the difficulty band
  var MIN_ATTEMPTS = 5;     // below this, accuracy is noise rather than signal

  var DEFAULT_STATS = { answered: 0, correct: 0, streak: 0, byTopic: {}, recent: [] };

  function getStats() {
    var st = S.read(S.KEYS.stats, DEFAULT_STATS);
    // A stats object written before these fields existed merges as a shallow
    // copy, so guard the shapes rather than trusting them.
    if (!st.byTopic || typeof st.byTopic !== 'object') st.byTopic = {};
    if (!Array.isArray(st.recent)) st.recent = [];
    return st;
  }

  function setStats(st) { S.write(S.KEYS.stats, st); }

  function recordResult(correct, total) {
    var st = getStats();
    st.answered += Math.max(0, total | 0);
    st.correct += Math.max(0, correct | 0);
    st.streak = (total > 0 && correct === total) ? st.streak + 1 : 0;
    setStats(st);
    return st;
  }

  function resetStats() { setStats(S.clone(DEFAULT_STATS)); }

  function getReview() { return S.read(S.KEYS.review, {}); }
  function setReview(r) { S.write(S.KEYS.review, r); }
  function reviewCount() { return Object.keys(getReview()).length; }

  function recordAnswer(question, wasCorrect) {
    if (!question || !question.id) return;

    // ---- per-topic and rolling window ----
    var st = getStats();
    var cat = question.category || 'unknown';
    var t = st.byTopic[cat] || { answered: 0, correct: 0 };
    t.answered += 1;
    if (wasCorrect) t.correct += 1;
    st.byTopic[cat] = t;
    st.recent.push(wasCorrect ? 1 : 0);
    if (st.recent.length > RECENT_MAX) st.recent = st.recent.slice(-RECENT_MAX);
    setStats(st);

    // ---- spaced repetition ----
    var review = getReview();
    var entry = review[question.id];
    if (wasCorrect) {
      if (!entry) return;                    // never missed — nothing to track
      entry.streak = (entry.streak || 0) + 1;
      if (entry.streak >= RETIRE_AFTER) delete review[question.id];
      else review[question.id] = entry;
    } else {
      review[question.id] = {
        misses: entry ? (entry.misses || 0) + 1 : 1,
        streak: 0,                           // a miss resets progress
        lastMissedAt: Date.now()
      };
    }
    setReview(review);
  }

  // Most-missed first: the questions that keep catching you out earn the slots.
  function pickReviewQuestions(bank, limit) {
    var review = getReview();
    return bank
      .filter(function (q) { return review[q.id]; })
      .sort(function (a, b) { return (review[b.id].misses || 0) - (review[a.id].misses || 0); })
      .slice(0, Math.max(0, limit));
  }

  function topicAccuracy(topicId) {
    var t = getStats().byTopic[topicId];
    if (!t || t.answered < MIN_ATTEMPTS) return null;
    return t.correct / t.answered;
  }

  function recentAccuracy() {
    var r = getStats().recent;
    if (r.length < MIN_ATTEMPTS) return null;
    var sum = r.reduce(function (a, b) { return a + b; }, 0);
    return sum / r.length;
  }

  // Weakest first, because that is the row worth acting on. Topics never
  // attempted carry a null accuracy and sort to the bottom rather than
  // pretending to be 0% and topping the list.
  function topicBreakdown() {
    var byTopic = getStats().byTopic;
    return Object.keys(byTopic).map(function (id) {
      var t = byTopic[id];
      return {
        id: id,
        answered: t.answered || 0,
        correct: t.correct || 0,
        accuracy: t.answered ? t.correct / t.answered : null
      };
    }).sort(function (a, b) {
      if (a.accuracy === null && b.accuracy === null) return a.id < b.id ? -1 : 1;
      if (a.accuracy === null) return 1;
      if (b.accuracy === null) return -1;
      return a.accuracy - b.accuracy;
    });
  }

  /* ---------- backup ----------
   * This data exists nowhere else — no server, no account. Import therefore
   * merges rather than replaces: silently discarding months of review history
   * because a file was imported in the wrong order would be unrecoverable.
   */

  function exportPayload() {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: S.read(S.KEYS.settings, {}),
      stats: getStats(),
      review: getReview()
    };
  }

  function importPayload(payload) {
    if (!payload || payload.version !== 1) {
      return { ok: false, error: 'unrecognised backup format' };
    }
    if (!payload.stats || typeof payload.stats !== 'object') {
      return { ok: false, error: 'backup contains no stats' };
    }

    var local = getStats();
    var inc = payload.stats;
    var merged = {
      answered: (local.answered || 0) + (inc.answered || 0),
      correct: (local.correct || 0) + (inc.correct || 0),
      streak: Math.max(local.streak || 0, inc.streak || 0),
      byTopic: {},
      recent: (Array.isArray(inc.recent) ? inc.recent : [])
        .concat(local.recent).slice(-RECENT_MAX)
    };

    var ids = Object.keys(local.byTopic).concat(Object.keys(inc.byTopic || {}));
    ids.forEach(function (id) {
      if (merged.byTopic[id]) return;
      var a = local.byTopic[id] || { answered: 0, correct: 0 };
      var b = (inc.byTopic || {})[id] || { answered: 0, correct: 0 };
      merged.byTopic[id] = {
        answered: (a.answered || 0) + (b.answered || 0),
        correct: (a.correct || 0) + (b.correct || 0)
      };
    });
    setStats(merged);

    // Review entries union; the higher miss count is the more cautious answer.
    var review = getReview();
    var incReview = payload.review || {};
    Object.keys(incReview).forEach(function (id) {
      var mine = review[id];
      var theirs = incReview[id];
      if (!mine || (theirs.misses || 0) > (mine.misses || 0)) review[id] = theirs;
    });
    setReview(review);

    if (payload.settings && typeof payload.settings === 'object') {
      S.write(S.KEYS.settings, payload.settings);
    }
    return { ok: true };
  }

  global.KinvtProgress = {
    DEFAULT_STATS: DEFAULT_STATS,
    getStats: getStats,
    recordResult: recordResult,
    recordAnswer: recordAnswer,
    resetStats: resetStats,
    getReview: getReview,
    reviewCount: reviewCount,
    pickReviewQuestions: pickReviewQuestions,
    topicAccuracy: topicAccuracy,
    recentAccuracy: recentAccuracy,
    topicBreakdown: topicBreakdown,
    exportPayload: exportPayload,
    importPayload: importPayload
  };
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/test/progress.test.mjs`
Expected: PASS — 13 tests.

- [ ] **Step 5: Commit**

```bash
git add desktop/ui/progress.js scripts/test/progress.test.mjs
git commit -m "Track accuracy per topic and a rolling window, plus backup payloads"
```

---

### Task 3: `selection.js` — topic weighting and difficulty banding

**Files:**
- Create: `desktop/ui/selection.js`
- Create: `scripts/test/selection.test.mjs`

**Interfaces:**
- Consumes: `KinvtProgress.{topicAccuracy, recentAccuracy, pickReviewQuestions}` from Task 2.
- Produces (`global.KinvtSelection`):
  - `MAX_WEIGHT` → `2`
  - `topicWeight(topicId: string) -> number` in `[1, 2]`
  - `targetBand() -> 'easy'|'medium'|'hard'`
  - `pick(bank: object[], count: number, opts?: {adaptive?: boolean, random?: () => number, exclude?: object}) -> object[]`

  `opts.random` defaults to `Math.random` and exists so tests are deterministic. `opts.exclude` is an id-keyed object of already-chosen questions.

- [ ] **Step 1: Write the failing test**

Create `scripts/test/selection.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules, makeLocalStorage } from './harness.mjs';

function load(stats) {
  const seed = stats ? { 'kinvt.stats': JSON.stringify(stats) } : {};
  const sandbox = loadModules(
    ['storage.js', 'progress.js', 'selection.js'],
    { localStorage: makeLocalStorage(seed) }
  );
  return sandbox.KinvtSelection;
}

const statsWith = (byTopic, recent = []) =>
  ({ answered: 0, correct: 0, streak: 0, byTopic, recent });

const q = (id, category, difficulty) => ({ id, category, difficulty });

test('an unattempted topic carries neutral weight', () => {
  const Sel = load();
  assert.equal(Sel.topicWeight('upsc'), 1);
});

test('weight rises as accuracy falls, capped at 2', () => {
  const Sel = load(statsWith({
    strong: { answered: 10, correct: 9 },
    weak: { answered: 10, correct: 2 },
    hopeless: { answered: 10, correct: 0 }
  }));
  assert.ok(Math.abs(Sel.topicWeight('strong') - 1.1) < 1e-9);
  assert.ok(Math.abs(Sel.topicWeight('weak') - 1.8) < 1e-9);
  assert.equal(Sel.topicWeight('hopeless'), Sel.MAX_WEIGHT);
});

test('a topic below the attempt floor stays neutral despite bad accuracy', () => {
  const Sel = load(statsWith({ fresh: { answered: 3, correct: 0 } }));
  assert.equal(Sel.topicWeight('fresh'), 1);
});

test('targetBand defaults to medium without enough history', () => {
  assert.equal(load().targetBand(), 'medium');
  assert.equal(load(statsWith({}, [1, 1, 0])).targetBand(), 'medium');
});

test('targetBand tracks recent accuracy', () => {
  const strong = Array(10).fill(1);
  const mid = [1, 1, 1, 0, 1, 0, 1, 0, 1, 1];   // 70%
  const weak = [0, 0, 0, 0, 1, 0, 0, 0, 1, 0];  // 20%
  assert.equal(load(statsWith({}, strong)).targetBand(), 'hard');
  assert.equal(load(statsWith({}, mid)).targetBand(), 'medium');
  assert.equal(load(statsWith({}, weak)).targetBand(), 'easy');
});

test('pick returns the requested count without duplicates', () => {
  const Sel = load();
  const bank = Array.from({ length: 20 }, (_, i) => q(`q-${i}`, 'upsc', 'medium'));
  const got = Sel.pick(bank, 3, { random: () => 0.5 });
  assert.equal(got.length, 3);
  assert.equal(new Set(got.map(x => x.id)).size, 3);
});

test('pick never returns an excluded question', () => {
  const Sel = load();
  const bank = [q('a', 'upsc', 'easy'), q('b', 'upsc', 'easy'), q('c', 'upsc', 'easy')];
  const got = Sel.pick(bank, 2, { exclude: { a: true }, random: () => 0.5 });
  assert.equal(got.length, 2);
  assert.ok(!got.some(x => x.id === 'a'));
});

test('pick caps at the bank size rather than looping forever', () => {
  const Sel = load();
  const bank = [q('a', 'upsc', 'easy')];
  assert.equal(Sel.pick(bank, 5, { random: () => 0.5 }).length, 1);
});

test('adaptive picking favours the weaker topic over many draws', () => {
  const Sel = load(statsWith({
    strong: { answered: 20, correct: 20 },   // weight 1.0
    weak: { answered: 20, correct: 0 }       // weight 2.0
  }));
  const bank = [];
  for (let i = 0; i < 50; i++) bank.push(q(`s-${i}`, 'strong', 'medium'));
  for (let i = 0; i < 50; i++) bank.push(q(`w-${i}`, 'weak', 'medium'));

  let weak = 0;
  let seed = 1;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let trial = 0; trial < 400; trial++) {
    for (const picked of Sel.pick(bank, 1, { random })) {
      if (picked.category === 'weak') weak++;
    }
  }
  assert.ok(weak > 220, `expected the weak topic to dominate, got ${weak}/400`);
});

test('adaptive picking favours the target difficulty band', () => {
  const Sel = load(statsWith({}, Array(10).fill(1)));   // band = hard
  const bank = [];
  for (let i = 0; i < 50; i++) bank.push(q(`e-${i}`, 'upsc', 'easy'));
  for (let i = 0; i < 50; i++) bank.push(q(`h-${i}`, 'upsc', 'hard'));

  let hard = 0;
  let seed = 7;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let trial = 0; trial < 400; trial++) {
    for (const picked of Sel.pick(bank, 1, { random })) {
      if (picked.difficulty === 'hard') hard++;
    }
  }
  assert.ok(hard > 220, `expected hard questions to dominate, got ${hard}/400`);
});

test('adaptive:false ignores weighting entirely', () => {
  const Sel = load(statsWith({
    strong: { answered: 20, correct: 20 },
    weak: { answered: 20, correct: 0 }
  }));
  const bank = [];
  for (let i = 0; i < 50; i++) bank.push(q(`s-${i}`, 'strong', 'medium'));
  for (let i = 0; i < 50; i++) bank.push(q(`w-${i}`, 'weak', 'medium'));

  let weak = 0;
  let seed = 3;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let trial = 0; trial < 400; trial++) {
    for (const picked of Sel.pick(bank, 1, { adaptive: false, random })) {
      if (picked.category === 'weak') weak++;
    }
  }
  assert.ok(weak > 150 && weak < 250, `expected a roughly even split, got ${weak}/400`);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/test/selection.test.mjs`
Expected: FAIL — `ENOENT` on `desktop/ui/selection.js`.

- [ ] **Step 3: Write `selection.js`**

Create `desktop/ui/selection.js`:

```js
/*
 * Kinvt-study — which questions a popup actually gets.
 *
 * Two independent signals, both from data already recorded:
 *
 *   topic weighting  — a topic you are weak on gets more slots, up to 2x the
 *                      share of one you have mastered
 *   difficulty band  — a rolling window of recent answers picks the band to
 *                      lean toward, so the app follows you up and down
 *
 * Both are a BIAS applied to a weighted draw, never a filter. Filtering would
 * starve a bank that is thin on one difficulty, and would make the mix
 * monotonous the moment your accuracy settled.
 */
(function (global) {
  'use strict';

  var P = global.KinvtProgress;

  var MAX_WEIGHT = 2;       // a topic at 0% accuracy, twice a mastered one
  var BAND_BONUS = 2.5;     // multiplier for a question in the target band
  var HARD_ABOVE = 0.75;
  var EASY_BELOW = 0.5;

  function topicWeight(topicId) {
    var acc = P.topicAccuracy(topicId);
    if (acc === null) return 1;                  // too little signal to act on
    var w = 1 + (1 - acc);
    return Math.max(1, Math.min(MAX_WEIGHT, w));
  }

  function targetBand() {
    var acc = P.recentAccuracy();
    if (acc === null) return 'medium';
    if (acc > HARD_ABOVE) return 'hard';
    if (acc >= EASY_BELOW) return 'medium';
    return 'easy';
  }

  // Weighted sampling without replacement: score each candidate as
  // weight * random and take the best. A higher weight shifts the
  // distribution of the score upward, so it wins more often — but never
  // always, which is what keeps the mix varied.
  function pick(bank, count, opts) {
    opts = opts || {};
    var random = opts.random || Math.random;
    var adaptive = opts.adaptive !== false;
    var exclude = opts.exclude || {};
    var band = adaptive ? targetBand() : null;

    var scored = [];
    for (var i = 0; i < bank.length; i++) {
      var q = bank[i];
      if (!q || exclude[q.id]) continue;
      var score;
      if (adaptive) {
        var bonus = (q.difficulty === band) ? BAND_BONUS : 1;
        score = topicWeight(q.category) * bonus * random();
      } else {
        score = random();
      }
      scored.push({ q: q, score: score });
    }

    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, Math.max(0, Math.min(count, scored.length)))
      .map(function (x) { return x.q; });
  }

  global.KinvtSelection = {
    MAX_WEIGHT: MAX_WEIGHT,
    topicWeight: topicWeight,
    targetBand: targetBand,
    pick: pick
  };
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/test/selection.test.mjs`
Expected: PASS — 11 tests.

- [ ] **Step 5: Commit**

```bash
git add desktop/ui/selection.js scripts/test/selection.test.mjs
git commit -m "Weight question selection by topic weakness and recent accuracy"
```

---

### Task 4: Rewire `quiz-engine.js` onto the new modules

Behaviour-preserving except that `buildQuiz` now fills its non-review slots via `KinvtSelection.pick`.

**Files:**
- Modify: `desktop/ui/quiz-engine.js` (full rewrite of the file)
- Modify: `desktop/ui/index.html:60-62`
- Modify: `desktop/ui/settings.html:124-125`
- Modify: `desktop/ui/_preview.html:34-36`

**Interfaces:**
- Consumes: `KinvtStorage`, `KinvtProgress`, `KinvtSelection` from Tasks 1–3.
- Produces: `KinvtQuiz` with its existing members unchanged — `DEFAULT_SETTINGS`, `DEFAULT_STATS`, `getSettings`, `setSettings`, `getStats`, `recordResult`, `resetStats`, `loadLibrary`, `buildQuiz`, `syncContent`, `recordAnswer`, `reviewCount`, `lastSyncAt` — plus re-exports `topicBreakdown`, `exportPayload`, `importPayload`, and new `getSnoozeUntil() -> number`, `setSnoozeUntil(ts: number) -> void`.

- [ ] **Step 1: Replace `quiz-engine.js`**

Overwrite `desktop/ui/quiz-engine.js`:

```js
/*
 * Kinvt-study — settings, the question library, and building one quiz.
 *
 * The pieces that used to live here have moved to focused modules:
 *   storage.js    — localStorage
 *   progress.js   — stats and spaced repetition
 *   selection.js  — which questions a popup gets
 *
 * What is left is the library (bundled JSON plus a daily remote sync) and the
 * assembly of a single quiz. KinvtQuiz stays the one public surface, so
 * app.js and settings.js do not care that the split happened.
 */
(function (global) {
  'use strict';

  var S = global.KinvtStorage;
  var P = global.KinvtProgress;
  var Sel = global.KinvtSelection;

  var DEFAULT_SETTINGS = {
    enabled: true,
    intervalMin: 30,
    perQuiz: 3,
    durationSec: 45,
    theme: 'dark',
    glass: 'balanced',
    glassCustom: 70,
    adaptive: true,
    respectDnd: true,
    topics: {
      'general-knowledge': true,
      'upsc': true,
      'kpsc': true,
      'current-affairs': true,
      'ssc': false,
      'banking': false,
      'railways': false,
      'defence': false,
      'constitution-polity': false,
      'indian-history': false,
      'geography': false,
      'economy': false,
      'science-tech': false,
      'environment': false,
      'sports': false,
      'karnataka-gk': false
    }
  };

  function getSettings() {
    var s = S.read(S.KEYS.settings, DEFAULT_SETTINGS);
    s.topics = Object.assign({}, DEFAULT_SETTINGS.topics, s.topics || {});
    return s;
  }

  function setSettings(s) { S.write(S.KEYS.settings, s); }

  function getSnoozeUntil() { return S.readNumber(S.KEYS.snoozeUntil); }
  function setSnoozeUntil(ts) { S.writeNumber(S.KEYS.snoozeUntil, ts); }

  function loadLibrary() {
    return fetch('library.json').then(function (r) { return r.json(); });
  }

  /* ---------- daily content sync ----------
   * Questions ship bundled so the app is fully functional offline, but a
   * bundled bank only changes when the app is reinstalled. Syncing from the
   * public repo once a day decouples content freshness from app releases.
   *
   * Merged by `id` — same id updates that question, a new id adds one.
   * A failed fetch leaves the bundled copy untouched, so the library can
   * never end up empty.
   */

  var REMOTE_BASE = 'https://raw.githubusercontent.com/vinayakawac/kinvt-study/main/';
  var SYNC_EVERY_MS = 24 * 60 * 60 * 1000;

  function getRemoteLibrary() { return S.read(S.KEYS.remote, {}); }

  function mergeById(bundled, remote) {
    if (!remote || !remote.length) return bundled;
    var map = new Map(bundled.map(function (q) { return [q.id, q]; }));
    remote.forEach(function (q) { map.set(q.id, q); });
    return Array.from(map.values());
  }

  function syncContent(force) {
    var last = S.readNumber(S.KEYS.syncAt);
    if (!force && Date.now() - last < SYNC_EVERY_MS) return Promise.resolve(false);

    return loadLibrary().then(function (catalog) {
      return Promise.all(catalog.map(function (cat) {
        return fetch(REMOTE_BASE + cat.file + '?cb=' + Date.now(), { cache: 'no-store' })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (d) {
            return (d && Array.isArray(d.questions)) ? { id: cat.id, questions: d.questions } : null;
          })
          .catch(function () { return null; }); // offline — keep the bundled copy
      }));
    }).then(function (results) {
      var store = getRemoteLibrary();
      var updated = false;
      results.forEach(function (r) {
        if (r) { store[r.id] = { questions: r.questions, updatedAt: Date.now() }; updated = true; }
      });
      if (updated) {
        S.write(S.KEYS.remote, store);
        S.writeNumber(S.KEYS.syncAt, Date.now());
      }
      return updated;
    }).catch(function () { return false; });
  }

  var REVIEW_SHARE = 0.5;   // at most half a popup is review material

  // Builds one quiz from the selected topics. Resolves null when nothing is
  // selected or no bank could be read, so callers can stay quiet rather than
  // showing an empty card.
  function buildQuiz() {
    var settings = getSettings();
    var activeIds = Object.keys(settings.topics).filter(function (k) { return settings.topics[k]; });
    if (!activeIds.length) return Promise.resolve(null);

    return loadLibrary().then(function (catalog) {
      var wanted = catalog.filter(function (c) { return activeIds.indexOf(c.id) !== -1; });
      return Promise.all(wanted.map(function (cat) {
        return fetch(cat.file)
          .then(function (r) { return r.json(); })
          .then(function (d) {
            var remote = getRemoteLibrary()[cat.id];
            return {
              label: cat.label,
              questions: mergeById(d.questions || [], remote && remote.questions)
            };
          })
          .catch(function () { return { label: cat.label, questions: [] }; });
      })).then(function (loaded) {
        var bank = [];
        var labels = [];
        loaded.forEach(function (x) {
          if (x.questions.length) { labels.push(x.label); }
          bank = bank.concat(x.questions);
        });
        if (!bank.length) return null;

        var perQuiz = Math.max(1, Math.min(Math.round(settings.perQuiz) || 3, bank.length));

        // Review first, capped so a popup never becomes nothing but review —
        // new material still has to get through. The rest is drawn adaptively.
        var picked = [];
        if (settings.review !== false) {
          picked = P.pickReviewQuestions(bank, Math.floor(perQuiz * REVIEW_SHARE));
        }
        var chosenIds = {};
        picked.forEach(function (q) { chosenIds[q.id] = true; });

        picked = picked.concat(Sel.pick(bank, perQuiz - picked.length, {
          adaptive: settings.adaptive !== false,
          exclude: chosenIds
        }));

        // Don't always lead with the review questions.
        for (var i = picked.length - 1; i > 0; i--) {
          var j = Math.floor(Math.random() * (i + 1));
          var t = picked[i]; picked[i] = picked[j]; picked[j] = t;
        }

        var title = labels.length <= 2
          ? labels.join(' · ')
          : labels.slice(0, 2).join(' · ') + ' +' + (labels.length - 2) + ' more';

        return {
          questions: picked,
          title: title,
          durationSec: Math.round(settings.durationSec) || 45,
          theme: settings.theme || 'dark',
          glass: settings.glass || 'balanced',
          glassCustom: settings.glassCustom | 0 || 70
        };
      });
    }).catch(function () { return null; });
  }

  global.KinvtQuiz = {
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    DEFAULT_STATS: P.DEFAULT_STATS,
    getSettings: getSettings,
    setSettings: setSettings,
    getStats: P.getStats,
    recordResult: P.recordResult,
    resetStats: P.resetStats,
    recordAnswer: P.recordAnswer,
    reviewCount: P.reviewCount,
    topicBreakdown: P.topicBreakdown,
    exportPayload: P.exportPayload,
    importPayload: P.importPayload,
    getSnoozeUntil: getSnoozeUntil,
    setSnoozeUntil: setSnoozeUntil,
    loadLibrary: loadLibrary,
    buildQuiz: buildQuiz,
    syncContent: syncContent,
    lastSyncAt: function () { return S.readNumber(S.KEYS.syncAt); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 2: Update the three script tag blocks**

In `desktop/ui/index.html`, replace lines 60–62:

```html
  <script src="ui-core.js"></script>
  <script src="storage.js"></script>
  <script src="progress.js"></script>
  <script src="selection.js"></script>
  <script src="quiz-engine.js"></script>
  <script src="app.js"></script>
```

In `desktop/ui/settings.html`, replace lines 124–125:

```html
  <script src="storage.js"></script>
  <script src="progress.js"></script>
  <script src="selection.js"></script>
  <script src="quiz-engine.js"></script>
  <script src="settings.js"></script>
```

In `desktop/ui/_preview.html`, replace lines 34–36:

```html
  <script src="ui-core.js"></script>
  <script src="storage.js"></script>
  <script src="progress.js"></script>
  <script src="selection.js"></script>
  <script src="quiz-engine.js"></script>
  <script src="app.js"></script>
```

- [ ] **Step 3: Write a test that the public surface did not regress**

Create `scripts/test/quiz-engine.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './harness.mjs';

const MODULES = ['storage.js', 'progress.js', 'selection.js', 'quiz-engine.js'];

test('KinvtQuiz still exposes everything app.js and settings.js call', () => {
  const { KinvtQuiz } = loadModules(MODULES);
  for (const name of [
    'DEFAULT_SETTINGS', 'DEFAULT_STATS', 'getSettings', 'setSettings',
    'getStats', 'recordResult', 'resetStats', 'recordAnswer', 'reviewCount',
    'loadLibrary', 'buildQuiz', 'syncContent', 'lastSyncAt',
    'topicBreakdown', 'exportPayload', 'importPayload',
    'getSnoozeUntil', 'setSnoozeUntil'
  ]) {
    assert.ok(name in KinvtQuiz, `KinvtQuiz.${name} is missing`);
  }
});

test('settings defaults gain adaptive and respectDnd, both on', () => {
  const { KinvtQuiz } = loadModules(MODULES);
  const s = KinvtQuiz.getSettings();
  assert.equal(s.adaptive, true);
  assert.equal(s.respectDnd, true);
  assert.equal(s.intervalMin, 30, 'existing defaults are untouched');
  assert.equal(Object.keys(s.topics).length, 16);
});

test('stored settings from an older version still load', () => {
  const { KinvtQuiz } = loadModules(MODULES);
  KinvtQuiz.setSettings({ intervalMin: 90, topics: { upsc: true } });
  const s = KinvtQuiz.getSettings();
  assert.equal(s.intervalMin, 90);
  assert.equal(s.adaptive, true, 'a missing new field falls back to its default');
  assert.equal(s.topics.ssc, false, 'topics are topped up from defaults');
});

test('snooze round-trips', () => {
  const { KinvtQuiz } = loadModules(MODULES);
  assert.equal(KinvtQuiz.getSnoozeUntil(), 0);
  KinvtQuiz.setSnoozeUntil(1755300000000);
  assert.equal(KinvtQuiz.getSnoozeUntil(), 1755300000000);
});
```

- [ ] **Step 4: Run the full suite**

Run: `node --test scripts/test/`
Expected: PASS — all four test files.

- [ ] **Step 5: Verify the UI still runs**

Open `desktop/ui/_preview.html` in a browser (it uses `_preview-shim.js` so no Tauri is needed). Confirm a card renders and answering advances it. There is no automated coverage of the webview, so this manual check is the gate.

- [ ] **Step 6: Commit**

```bash
git add desktop/ui/quiz-engine.js desktop/ui/index.html desktop/ui/settings.html desktop/ui/_preview.html scripts/test/quiz-engine.test.mjs
git commit -m "Rewire the engine onto storage/progress/selection; fill slots adaptively"
```

---

### Task 5: Progress dashboard in Settings

**Files:**
- Modify: `desktop/ui/settings.html:107-113` (replace the stats section)
- Modify: `desktop/ui/settings.js:152-160` (`renderStats`)
- Modify: `desktop/ui/settings.css` (append)

**Interfaces:**
- Consumes: `KinvtQuiz.{getStats, reviewCount, topicBreakdown, lastSyncAt, loadLibrary}` from Task 4.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Replace the stats section markup**

In `desktop/ui/settings.html`, replace lines 107–113 with:

```html
  <section class="card">
    <div class="sec-head"><h2>Progress</h2></div>
    <div class="stats">
      <div class="stat"><b id="stAnswered">0</b><span>answered</span></div>
      <div class="stat"><b id="stCorrect">0</b><span>correct</span></div>
      <div class="stat"><b id="stAcc">–</b><span>accuracy</span></div>
      <div class="stat"><b id="stStreak">0</b><span>perfect streaks</span></div>
      <div class="stat"><b id="stReview">0</b><span>to review</span></div>
    </div>
    <p class="hint" id="stSync">Never synced</p>
    <div id="topicStats" class="topic-stats"></div>
  </section>
```

- [ ] **Step 2: Replace `renderStats`**

In `desktop/ui/settings.js`, replace the `renderStats` function (lines 152–160) with:

```js
  // Weakest topic first — that is the row worth acting on. Alphabetical order
  // would bury it.
  function renderTopicStats() {
    var host = $('topicStats');
    if (!host) return;
    var rows = window.KinvtQuiz.topicBreakdown();
    if (!rows.length) {
      host.innerHTML = '<p class="hint">No questions answered yet — your weakest topics will appear here.</p>';
      return;
    }
    var labels = topicLabels;   // filled in by renderLibrary
    host.innerHTML = rows.map(function (r) {
      var name = labels[r.id] || r.id;
      if (r.accuracy === null) {
        return '<div class="trow muted"><span class="tname">' + name + '</span>' +
               '<span class="tval">not started</span></div>';
      }
      var pct = Math.round(r.accuracy * 100);
      return '<div class="trow">' +
        '<span class="tname">' + name + '</span>' +
        '<span class="tbar"><i style="width:' + pct + '%"></i></span>' +
        '<span class="tval">' + pct + '% <em>' + r.answered + '</em></span>' +
        '</div>';
    }).join('');
  }

  function renderStats() {
    var st = window.KinvtQuiz.getStats();
    $('stAnswered').textContent = st.answered;
    $('stCorrect').textContent = st.correct;
    $('stAcc').textContent = st.answered ? Math.round((st.correct / st.answered) * 100) + '%' : '–';
    $('stStreak').textContent = st.streak;
    var rev = $('stReview');
    if (rev) rev.textContent = window.KinvtQuiz.reviewCount();

    var sync = $('stSync');
    if (sync) {
      var at = window.KinvtQuiz.lastSyncAt();
      sync.textContent = at ? 'Library last synced ' + new Date(at).toLocaleString() : 'Never synced';
    }
    renderTopicStats();
  }
```

- [ ] **Step 3: Capture topic labels when the library renders**

In `desktop/ui/settings.js`, add below `var flashTimer = null;` (line 17):

```js
  var topicLabels = {};   // id -> human label, filled once the library loads
```

Then inside `renderLibrary`, immediately after `wrap.innerHTML = '';`, add:

```js
    catalog.forEach(function (cat) { topicLabels[cat.id] = cat.label; });
```

And in `init`, change the library load so the dashboard re-renders once labels exist — replace the existing `loadLibrary().then(renderLibrary)` call with:

```js
    window.KinvtQuiz.loadLibrary().then(function (catalog) {
      renderLibrary(catalog);
      renderTopicStats();   // labels are known now
    }).catch(function (err) {
      $('cats').textContent = 'Could not load the library: ' + err;
    });
```

- [ ] **Step 4: Add the styles**

Append to `desktop/ui/settings.css`:

```css
/* ---- per-topic progress ---- */
.topic-stats { margin-top: 12px; display: flex; flex-direction: column; gap: 6px; }
.topic-stats .trow { display: grid; grid-template-columns: 1fr 90px 74px; align-items: center; gap: 10px; font-size: 13px; }
.topic-stats .tname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.topic-stats .tbar { height: 6px; border-radius: 3px; background: rgba(127,127,127,.22); overflow: hidden; }
.topic-stats .tbar i { display: block; height: 100%; border-radius: 3px; background: currentColor; opacity: .55; }
.topic-stats .tval { text-align: right; font-variant-numeric: tabular-nums; }
.topic-stats .tval em { opacity: .5; font-style: normal; margin-left: 4px; }
.topic-stats .trow.muted { grid-template-columns: 1fr auto; opacity: .45; }
```

- [ ] **Step 5: Verify in the browser**

Open `desktop/ui/settings.html` via the preview path. In the devtools console seed some data, then reload:

```js
localStorage.setItem('kinvt.stats', JSON.stringify({
  answered: 20, correct: 12, streak: 1, recent: [1,0,1],
  byTopic: { upsc: {answered:10,correct:2}, ssc: {answered:10,correct:9} }
}));
```

Expected: UPSC (20%) appears above SSC (90%), each with a bar.

- [ ] **Step 6: Commit**

```bash
git add desktop/ui/settings.html desktop/ui/settings.js desktop/ui/settings.css
git commit -m "Show per-topic accuracy in Settings, weakest first"
```

---

### Task 6: Adaptive toggle and DND toggle in Settings

**Files:**
- Modify: `desktop/ui/settings.html` (inside the first `<section class="card">`, before its closing tag at line 55)
- Modify: `desktop/ui/settings.js` (`init`)

**Interfaces:**
- Consumes: `KinvtQuiz.getSettings()` fields `adaptive`, `respectDnd` from Task 4.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the two rows**

In `desktop/ui/settings.html`, immediately before the `</section>` on line 55, insert:

```html
    <label class="row switch">
      <input type="checkbox" id="adaptive">
      <span class="txt"><b>Adapt to my performance</b>
        <i>Weight weak topics more heavily and match difficulty to your recent accuracy.</i></span>
    </label>
    <label class="row switch">
      <input type="checkbox" id="respectDnd">
      <span class="txt"><b>Stay quiet when I'm busy</b>
        <i>Skip scheduled popups during fullscreen apps, presentations and Focus Assist. The hotkey always works.</i></span>
    </label>
```

- [ ] **Step 2: Wire them up**

In `desktop/ui/settings.js`, inside `init`, after the `$('theme').value = settings.theme;` line, add:

```js
    $('adaptive').checked = settings.adaptive !== false;
    $('respectDnd').checked = settings.respectDnd !== false;
```

And after the existing `$('theme').addEventListener(...)` block, add:

```js
    $('adaptive').addEventListener('change', function () { settings.adaptive = this.checked; save(); });
    $('respectDnd').addEventListener('change', function () { settings.respectDnd = this.checked; save(); });
```

- [ ] **Step 3: Verify**

Open Settings in the preview, toggle both, reload. Expected: both retain their state; `localStorage.getItem('kinvt.settings')` shows `"adaptive":false` after unchecking.

- [ ] **Step 4: Commit**

```bash
git add desktop/ui/settings.html desktop/ui/settings.js
git commit -m "Expose the adaptive and do-not-disturb toggles"
```

---

### Task 7: Generalize the validator and repair the expansion pipeline

The validator currently hard-codes `category === 'current-affairs'`, so it rejects every question in the other 15 topics — which is why the expansion workflow has never passed. `expand-library.mjs` reads `library.json` from the repo root, where it does not exist.

**Files:**
- Modify: `scripts/validate-questions.mjs` (full rewrite)
- Modify: `scripts/expand-library.mjs:22`, `:86-90`, `:125-127`
- Modify: `.github/workflows/expand-library.yml` (validate step)
- Create: `scripts/test/validate.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `node scripts/validate-questions.mjs <path> [--require-source]`, exit 0 on pass, 1 on failure, 2 on usage error.

- [ ] **Step 1: Write the failing test**

Create `scripts/test/validate.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function run(bank, { name = 'upsc.json', args = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kinvt-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(bank));
  try {
    const out = execFileSync('node', ['scripts/validate-questions.mjs', file, ...args], { encoding: 'utf8' });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

const good = (over = {}) => ({
  id: 'up-001', category: 'upsc', topic: 'Polity', difficulty: 'medium',
  question: 'Under which Article can President’s Rule be imposed?',
  options: ['Article 352', 'Article 356', 'Article 360', 'Article 365'],
  answer: 1,
  explanation: 'Article 356 covers failure of constitutional machinery in a state, not emergencies.',
  source: 'https://en.wikipedia.org/wiki/President%27s_rule',
  ...over
});

test('a well-formed non-current-affairs bank passes', () => {
  const r = run({ questions: [good()] });
  assert.equal(r.code, 0, r.out);
});

test('category must match the topic id taken from the filename', () => {
  const r = run({ questions: [good({ category: 'ssc' })] });
  assert.equal(r.code, 1);
  assert.match(r.out, /category/);
});

test('an out-of-range answer index fails', () => {
  const r = run({ questions: [good({ answer: 4 })] });
  assert.equal(r.code, 1);
  assert.match(r.out, /out of range/);
});

test('duplicate ids fail', () => {
  const r = run({ questions: [good(), good({ question: 'Another question entirely here?' })] });
  assert.equal(r.code, 1);
  assert.match(r.out, /duplicate id/);
});

test('a missing source warns by default and fails under --require-source', () => {
  const bank = { questions: [good({ source: undefined })] };
  assert.equal(run(bank).code, 0);
  const strict = run(bank, { args: ['--require-source'] });
  assert.equal(strict.code, 1);
  assert.match(strict.out, /source/);
});

test('a too-short explanation fails', () => {
  const r = run({ questions: [good({ explanation: 'Article 356.' })] });
  assert.equal(r.code, 1);
  assert.match(r.out, /explanation/);
});

test('an explanation that only restates the answer fails', () => {
  const r = run({ questions: [good({ explanation: 'The correct answer is Article 356.' })] });
  assert.equal(r.code, 1);
  assert.match(r.out, /restates/);
});

test('every shipped bank passes without --require-source', () => {
  for (const f of fs.readdirSync('desktop/ui/data')) {
    const r = execFileSync('node', ['scripts/validate-questions.mjs', path.join('desktop/ui/data', f)], { encoding: 'utf8' });
    assert.match(r, /passed validation/, `${f}: ${r}`);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/test/validate.test.mjs`
Expected: FAIL — the category test fails because the validator demands `current-affairs`, and the shipped-bank test fails for all 15 non-current-affairs banks.

- [ ] **Step 3: Rewrite the validator**

Overwrite `scripts/validate-questions.mjs`:

```js
// Gate for every question bank, generated or hand-written.
//
// It cannot check whether a fact is TRUE — no script can. It checks the
// failures that are mechanically detectable; the `source` URL is what lets a
// human check the rest.
//
// The topic id comes from the filename, so this works for all 16 banks. It
// used to hard-code 'current-affairs', which silently made it unusable as the
// gate for anything else.
//
// `source` is a warning by default and an error under --require-source. The
// 336 questions written before sources were required would otherwise fail
// their own gate; new content is generated with the flag on.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const requireSource = args.includes('--require-source');
const file = args.find(a => !a.startsWith('--'));

if (!file) {
  console.error('usage: validate-questions.mjs <path> [--require-source]');
  process.exit(2);
}

const topicId = path.basename(file, '.json');
const errors = [];
const warn = [];
let data;

try {
  data = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`✗ ${file} is not valid JSON: ${e.message}`);
  process.exit(1);
}

if (!Array.isArray(data.questions)) errors.push('`questions` must be an array');

const seenIds = new Set();
const seenText = new Set();
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

(data.questions || []).forEach((q, i) => {
  const at = `questions[${i}]${q?.id ? ` (${q.id})` : ''}`;

  if (!q.id || typeof q.id !== 'string') errors.push(`${at}: missing string id`);
  else if (seenIds.has(q.id)) errors.push(`${at}: duplicate id`);
  else seenIds.add(q.id);

  if (!q.question || typeof q.question !== 'string') errors.push(`${at}: missing question text`);
  else {
    // The same question worded identically twice is a generation artifact.
    const n = norm(q.question);
    if (seenText.has(n)) errors.push(`${at}: duplicate question text`);
    else seenText.add(n);
  }

  if (!Array.isArray(q.options) || q.options.length !== 4) {
    errors.push(`${at}: needs exactly 4 options`);
  } else {
    if (new Set(q.options.map(String)).size !== 4) errors.push(`${at}: options are not distinct`);
    if (q.options.some(o => typeof o !== 'string' || !o.trim())) errors.push(`${at}: blank option`);
  }

  // The single most dangerous field: an out-of-range or missing answer index
  // silently makes every attempt wrong.
  if (!Number.isInteger(q.answer)) errors.push(`${at}: answer must be an integer index`);
  else if (!Array.isArray(q.options) || q.answer < 0 || q.answer >= q.options.length) {
    errors.push(`${at}: answer ${q.answer} is out of range`);
  }

  const expl = String(q.explanation || '').trim();
  if (!expl) {
    errors.push(`${at}: no explanation — the wrong-answer feedback would be blank`);
  } else if (expl.length < 40) {
    errors.push(`${at}: explanation is too short to teach anything (${expl.length} chars, need 40)`);
  } else if (Array.isArray(q.options) && Number.isInteger(q.answer) && q.options[q.answer]) {
    // "The correct answer is X." teaches nothing the card has not already shown.
    const answerText = norm(q.options[q.answer]);
    const stripped = norm(expl).replace(answerText, '').replace(/^(the correct answer is|the answer is|it is|this is)\s*/, '').trim();
    if (stripped.length < 20) errors.push(`${at}: explanation merely restates the answer`);
  }

  if (!q.source || !/^https?:\/\//.test(String(q.source))) {
    const msg = `${at}: needs a source URL so the fact can be checked by a human`;
    if (requireSource) errors.push(msg); else warn.push(msg);
  }

  if (q.category !== topicId) {
    errors.push(`${at}: category is "${q.category}", expected "${topicId}" to match the filename`);
  }
});

warn.forEach(w => console.log(`⚠ ${w}`));

if (errors.length) {
  console.error(`\n✗ ${errors.length} problem(s) in ${file}:`);
  errors.forEach(e => console.error('  - ' + e));
  process.exit(1);
}
console.log(`✓ ${file}: ${data.questions.length} questions passed validation`);
```

- [ ] **Step 4: Run the test**

Run: `node --test scripts/test/validate.test.mjs`
Expected: the seven synthetic tests PASS. The "every shipped bank passes" test may still FAIL if any existing question has a short or restating explanation — that is a real finding. If it fails, fix the offending explanations in `desktop/ui/data/*.json` and re-run until green. Do not weaken the check to make it pass.

- [ ] **Step 5: Repair `expand-library.mjs`**

In `scripts/expand-library.mjs`, replace line 22:

```js
// Content lives under desktop/ui/ and nowhere else. This used to read
// library.json from the repo root, where it has never existed, so the script
// threw before generating anything.
const UI_DIR = path.join('desktop', 'ui');
const library = JSON.parse(fs.readFileSync(path.join(UI_DIR, 'library.json'), 'utf8'));
```

Replace lines 86–90 with:

```js
  const file = path.join(UI_DIR, topic.file);
  let bank;
  try { bank = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { bank = { name: topic.label, description: topic.blurb, questions: [] }; }
```

Replace lines 124–127 (the write-and-mirror block) with:

```js
    // Write after every batch so an interrupted run keeps its progress.
    // There is one location for the banks; the old mirror-to-desktop/ui step
    // existed only because the primary path was wrong.
    fs.writeFileSync(file, JSON.stringify(bank, null, 2) + '\n');
```

- [ ] **Step 6: Fix the workflow's validate step**

In `.github/workflows/expand-library.yml`, replace the `Validate every topic` step's `run:` block with:

```yaml
        run: |
          fail=0
          for f in desktop/ui/data/*.json; do
            node scripts/validate-questions.mjs "$f" --require-source || fail=1
          done
          exit $fail
```

- [ ] **Step 7: Verify the repaired script gets past its old crash**

Run: `ANTHROPIC_API_KEY=dummy TARGET_COUNT=1 MAX_CALLS=0 node scripts/expand-library.mjs`
Expected: it reads every bank and prints one `<topic>: <n> questions (+0)` line per topic, with no `ENOENT`. `MAX_CALLS=0` means no API call is made, so no key is actually used.

- [ ] **Step 8: Commit**

```bash
git add scripts/validate-questions.mjs scripts/expand-library.mjs scripts/test/validate.test.mjs .github/workflows/expand-library.yml
git commit -m "Make the validator work for all 16 topics; fix expand-library's paths"
```

---

### Task 8: Source links in the quiz card

**Files:**
- Modify: `desktop/tauri/Cargo.toml` (dependencies)
- Modify: `desktop/tauri/src/main.rs` (new command + handler registration + plugin)
- Modify: `desktop/tauri/capabilities/default.json` (permissions)
- Modify: `desktop/ui/ui-core.js:212` (feedback markup), `:329` (fill it in), `:83-89` (styles)
- Modify: `desktop/main.js` (Electron parity)

**Interfaces:**
- Consumes: nothing.
- Produces: Tauri command `open_url(url: String) -> Result<(), String>`; rejects any URL not starting `http://` or `https://`.

- [ ] **Step 1: Add the opener plugin**

In `desktop/tauri/Cargo.toml`, under `[dependencies]`, add:

```toml
tauri-plugin-opener = "2"
```

- [ ] **Step 2: Add the command**

In `desktop/tauri/src/main.rs`, add after the `open_settings` function:

```rust
/// Open an external URL in the user's browser.
///
/// The webview's CSP is `default-src 'self'`, so a source link cannot navigate
/// in-place — and it should not: a quiz card is not a browser. The scheme
/// check is the security boundary. Without it this command would happily hand
/// the OS a local executable path to launch.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("only http and https URLs can be opened".into());
    }
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| e.to_string())
}
```

Register it in the `invoke_handler` list:

```rust
        .invoke_handler(tauri::generate_handler![
            show_quiz,
            hide_quiz,
            resize_quiz,
            open_settings,
            open_url
        ])
```

And add the plugin, immediately after `tauri::Builder::default()`:

```rust
        .plugin(tauri_plugin_opener::init())
```

- [ ] **Step 3: Grant the permission**

In `desktop/tauri/capabilities/default.json`, add to the `permissions` array:

```json
    "opener:default",
```

- [ ] **Step 4: Render the link**

In `desktop/ui/ui-core.js`, replace the feedback markup on line 212:

```js
          '<div class="tpq-feedback"><span class="tpq-verd"></span><span class="tpq-expl"></span>' +
          '<a class="tpq-src" href="#" hidden>Source</a></div>' +
```

Below the existing `var fbEl = container.querySelector('.tpq-feedback');` (line 234), add:

```js
    var fbSrc  = container.querySelector('.tpq-src');
    fbSrc.addEventListener('click', function (e) {
      e.preventDefault();
      var url = fbSrc.dataset.url;
      // The card runs under a self-only CSP, so the shell opens the page.
      if (url && window.__TAURI__) window.__TAURI__.core.invoke('open_url', { url: url });
      else if (url && window.KinvtShell) window.KinvtShell.openUrl(url);
    });
```

After the existing `fbExpl.textContent = q.explanation || '';` (line 329), add:

```js
      // A generated question is only trustworthy if the reader can check it.
      var src = typeof q.source === 'string' && /^https?:\/\//.test(q.source) ? q.source : '';
      fbSrc.hidden = !src;
      fbSrc.dataset.url = src;
```

Append to the style block, after the `.tpq-feedback .tpq-expl` rule (line 89):

```js
    '.tpq-feedback .tpq-src{display:inline-block;margin-top:6px;font-size:12px;opacity:.7;',
    'text-decoration:underline;cursor:pointer;color:inherit}',
    '.tpq-feedback .tpq-src:hover{opacity:1}',
```

- [ ] **Step 5: Electron parity**

In `desktop/preload.js`, expose a shell bridge (append to whatever `contextBridge.exposeInMainWorld` call already exists, or add one):

```js
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('KinvtShell', {
  openUrl: (url) => ipcRenderer.invoke('open-url', url)
});
```

In `desktop/main.js`, add near the other IPC handlers:

```js
const { shell, ipcMain } = require('electron');
ipcMain.handle('open-url', (_e, url) => {
  if (!/^https?:\/\//.test(String(url))) return;
  return shell.openExternal(url);
});
```

- [ ] **Step 6: Verify**

Run: `cd desktop/tauri && cargo build --release`
Expected: compiles clean.

Then launch the exe, press Ctrl+Shift+Q, answer a question that has a `source` (add one temporarily to `desktop/ui/data/upsc.json` question `up-001` if none do yet), and click **Source**.
Expected: the page opens in the default browser; the quiz window does not navigate.

- [ ] **Step 7: Commit**

```bash
git add desktop/tauri/Cargo.toml desktop/tauri/src/main.rs desktop/tauri/capabilities/default.json desktop/ui/ui-core.js desktop/main.js desktop/preload.js
git commit -m "Link each explanation to its source, opened by the shell not the webview"
```

---

### Task 9: Do-not-disturb

**Files:**
- Modify: `desktop/tauri/Cargo.toml` (windows-only dependency)
- Modify: `desktop/tauri/src/main.rs` (DND query, tray snooze item)
- Modify: `desktop/ui/app.js` (`startQuiz` gains a trigger argument)

**Interfaces:**
- Consumes: `KinvtQuiz.{getSettings, getSnoozeUntil, setSnoozeUntil}` from Task 4.
- Produces: Tauri command `dnd_active() -> bool` (true when the OS says the user should not be interrupted); tray event `snooze` emitted to the webview.

- [ ] **Step 1: Add the Windows dependency**

In `desktop/tauri/Cargo.toml`, after the `[dependencies]` block, add:

```toml
[target.'cfg(windows)'.dependencies]
windows = { version = "0.58", features = ["Win32_UI_Shell", "Win32_Foundation"] }
```

- [ ] **Step 2: Add the DND query**

In `desktop/tauri/src/main.rs`, add after the `open_url` function:

```rust
/// Whether the OS says now is a bad moment to put a window on screen.
///
/// One call covers every case that matters: fullscreen Direct3D (games),
/// presentation mode, busy/screen-sharing, and Focus Assist quiet time.
/// Anything other than "accepts notifications" means stay out of the way.
///
/// On failure this returns false — allowing the popup. A broken query should
/// not silently disable the whole product.
#[cfg(windows)]
#[tauri::command]
fn dnd_active() -> bool {
    use windows::Win32::UI::Shell::{SHQueryUserNotificationState, QUNS_ACCEPTS_NOTIFICATIONS};
    unsafe {
        match SHQueryUserNotificationState() {
            Ok(state) => state != QUNS_ACCEPTS_NOTIFICATIONS,
            Err(_) => false,
        }
    }
}

#[cfg(not(windows))]
#[tauri::command]
fn dnd_active() -> bool {
    false
}
```

Register it in `invoke_handler`, after `open_url`:

```rust
            open_url,
            dnd_active
```

- [ ] **Step 3: Add the tray snooze item**

In `desktop/tauri/src/main.rs`, inside `.setup(...)`, replace the tray menu construction with:

```rust
            let quiz_now = MenuItem::with_id(app, "quiz_now", "Quiz me now", true, None::<&str>)?;
            let snooze = MenuItem::with_id(app, "snooze", "Snooze 1 hour", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quiz_now, &snooze, &settings, &quit])?;
```

And add a match arm in `on_menu_event`, after the `"quiz_now"` arm:

```rust
                    // The webview owns all persisted state, so it records the
                    // snooze rather than Rust keeping a second source of truth.
                    "snooze" => { let _ = app.emit("snooze", ()); }
```

- [ ] **Step 4: Gate scheduled popups in `app.js`**

In `desktop/ui/app.js`, replace `startQuiz` and `scheduleNext` with:

```js
  // `manual` marks an explicit request — the hotkey or the tray. Those always
  // fire: silently swallowing a keypress reads as a bug, and the user pressing
  // the key IS the statement that now is a fine moment.
  function startQuiz(manual) {
    if (open) return; // never stack two cards in one window

    if (!manual) {
      var s = window.KinvtQuiz.getSettings();
      if (Date.now() < window.KinvtQuiz.getSnoozeUntil()) { scheduleNext(); return; }
      if (s.respectDnd !== false) {
        return invoke('dnd_active').then(function (busy) {
          // Skipped, not queued. Queuing would fire a burst of cards the
          // moment a game closes, which is worse than missing one.
          if (busy) { scheduleNext(); return; }
          return present();
        }).catch(function () { return present(); });
      }
    }
    return present();
  }

  function present() {
    return window.KinvtQuiz.buildQuiz().then(function (quiz) {
      if (!quiz) return; // nothing selected — stay quiet rather than show an empty card
      open = true;
      cardEl.innerHTML = '';

      window.TPQ_UI.create(cardEl, {
        questions: quiz.questions,
        title: quiz.title,
        durationSec: quiz.durationSec,
        theme: quiz.theme,
        glass: quiz.glass,
        glassCustom: quiz.glassCustom,
        skipSummary: true,   // answer-and-done, no summary screen
        onProgress: fitWindow,   // each question is a different height
        onAnswer: function (question, wasCorrect) {
          window.KinvtQuiz.recordAnswer(question, wasCorrect);
        },
        onFinish: function (correct, total) {
          window.KinvtQuiz.recordResult(correct, total);
          fitWindow();
        },
        onClose: hide
      });

      invoke('show_quiz');
      // Measure after layout, not during it.
      requestAnimationFrame(fitWindow);
    });
  }
```

Replace the scheduled fire inside `scheduleNext`:

```js
    timer = setTimeout(function () {
      startQuiz(false);
    }, mins * 60 * 1000);
```

Replace the event listener and add the snooze listener:

```js
  // Tray menu and the global hotkey both route through this event, so there
  // is one code path for "start a quiz now" — and both count as manual.
  listen('start-quiz', function () { startQuiz(true); });

  listen('snooze', function () {
    window.KinvtQuiz.setSnoozeUntil(Date.now() + 60 * 60 * 1000);
    scheduleNext();
  });
```

- [ ] **Step 5: Verify**

Run: `cd desktop/tauri && cargo build --release`
Expected: compiles clean.

Launch the exe. Set the interval to 1 minute in Settings, turn on **Stay quiet when I'm busy**, then start a fullscreen video or game and wait two minutes.
Expected: no popup appears. Press Ctrl+Shift+Q while still fullscreen — the card **does** appear. Exit fullscreen and confirm exactly one card appears at the next interval, not a burst.

Then use tray → **Snooze 1 hour** and confirm no scheduled popup fires while `localStorage.getItem('kinvt.snoozeUntil')` is in the future.

- [ ] **Step 6: Commit**

```bash
git add desktop/tauri/Cargo.toml desktop/tauri/src/main.rs desktop/ui/app.js
git commit -m "Skip scheduled popups during games, calls and Focus Assist"
```

---

### Task 10: Backup and restore

**Files:**
- Modify: `desktop/tauri/Cargo.toml` (dialog plugin)
- Modify: `desktop/tauri/src/main.rs` (two file commands + plugin)
- Modify: `desktop/tauri/capabilities/default.json`
- Modify: `desktop/ui/settings.html` (buttons in the Progress section)
- Modify: `desktop/ui/settings.js` (handlers)

**Interfaces:**
- Consumes: `KinvtQuiz.{exportPayload, importPayload}` from Task 4.
- Produces: Tauri commands `write_backup(path: String, contents: String) -> Result<(), String>` and `read_backup(path: String) -> Result<String, String>`.

- [ ] **Step 1: Add the dialog plugin**

In `desktop/tauri/Cargo.toml`, under `[dependencies]`:

```toml
tauri-plugin-dialog = "2"
```

- [ ] **Step 2: Add the file commands**

In `desktop/tauri/src/main.rs`, after `dnd_active`:

```rust
/// Read and write a backup file at a path the user picked.
///
/// The picker comes from the dialog plugin; the I/O is plain std::fs rather
/// than a second plugin, because the whole requirement is one read and one
/// write of a path the user has already chosen.
#[tauri::command]
fn write_backup(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_backup(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}
```

Register both in `invoke_handler`:

```rust
            dnd_active,
            write_backup,
            read_backup
```

Add the plugin next to the opener plugin:

```rust
        .plugin(tauri_plugin_dialog::init())
```

- [ ] **Step 3: Grant the permission**

In `desktop/tauri/capabilities/default.json`, add to `permissions`:

```json
    "dialog:default",
```

- [ ] **Step 4: Add the buttons**

In `desktop/ui/settings.html`, inside the Progress section, immediately before `</section>`:

```html
    <div class="row backup-row">
      <button type="button" id="exportBtn">Back up progress…</button>
      <button type="button" id="importBtn">Restore…</button>
    </div>
    <p class="hint" id="backupMsg"></p>
```

- [ ] **Step 5: Wire the handlers**

In `desktop/ui/settings.js`, inside `init`, before the closing `}`:

```js
    var dialog = window.__TAURI__.dialog;

    function backupMsg(text) { $('backupMsg').textContent = text; }

    $('exportBtn').addEventListener('click', function () {
      var stamp = new Date().toISOString().slice(0, 10);
      dialog.save({
        defaultPath: 'kinvt-study-backup-' + stamp + '.json',
        filters: [{ name: 'JSON', extensions: ['json'] }]
      }).then(function (path) {
        if (!path) return;                       // cancelled
        var payload = JSON.stringify(window.KinvtQuiz.exportPayload(), null, 2);
        return invoke('write_backup', { path: path, contents: payload })
          .then(function () { backupMsg('Backed up to ' + path); });
      }).catch(function (e) { backupMsg('Backup failed: ' + e); });
    });

    $('importBtn').addEventListener('click', function () {
      dialog.open({
        multiple: false,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      }).then(function (path) {
        if (!path) return;                       // cancelled
        return invoke('read_backup', { path: path }).then(function (text) {
          var payload;
          try { payload = JSON.parse(text); }
          catch (e) { backupMsg('That file is not valid JSON.'); return; }

          var res = window.KinvtQuiz.importPayload(payload);
          if (!res.ok) { backupMsg('Could not restore: ' + res.error); return; }

          // Restoring replaces settings, so re-read and redraw everything
          // rather than leaving the form showing the old values.
          settings = window.KinvtQuiz.getSettings();
          init();
          backupMsg('Restored. Existing progress was merged, not replaced.');
        });
      }).catch(function (e) { backupMsg('Restore failed: ' + e); });
    });
```

- [ ] **Step 6: Verify**

Run: `cd desktop/tauri && cargo build --release`

Launch, answer a few questions, click **Back up progress…** and save. Open the file: it must contain `"version": 1` and non-zero `stats`. Then answer more questions, click **Restore…**, pick the same file.
Expected: the message says progress was merged; the answered count is the sum, not the backup's value alone.

- [ ] **Step 7: Commit**

```bash
git add desktop/tauri/Cargo.toml desktop/tauri/src/main.rs desktop/tauri/capabilities/default.json desktop/ui/settings.html desktop/ui/settings.js
git commit -m "Back up and restore progress, merging rather than clobbering"
```

---

### Task 11: Auto-update

**Files:**
- Modify: `desktop/tauri/Cargo.toml`
- Modify: `desktop/tauri/src/main.rs` (plugins)
- Modify: `desktop/tauri/tauri.conf.json` (updater config)
- Modify: `desktop/tauri/capabilities/default.json`
- Modify: `desktop/ui/settings.html`, `desktop/ui/settings.js`
- Create: `.github/workflows/release.yml`
- Modify: `docs/DESKTOP_BUILD.md` (release + key generation section)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the plugins**

In `desktop/tauri/Cargo.toml`, under `[dependencies]`:

```toml
tauri-plugin-updater = "2"
tauri-plugin-process = "2"
```

In `desktop/tauri/src/main.rs`, alongside the other plugins:

```rust
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
```

- [ ] **Step 2: Configure the endpoint**

In `desktop/tauri/tauri.conf.json`, add a `plugins` block as a sibling of `bundle`:

```json
  "plugins": {
    "updater": {
      "endpoints": [
        "https://github.com/vinayakawac/kinvt-study/releases/latest/download/latest.json"
      ],
      "pubkey": "PASTE_YOUR_PUBLIC_KEY_HERE"
    }
  }
```

Also extend the CSP `connect-src` so the updater can reach GitHub:

```json
      "csp": "default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self' https://raw.githubusercontent.com https://github.com https://objects.githubusercontent.com"
```

- [ ] **Step 3: Grant the permissions**

In `desktop/tauri/capabilities/default.json`, add to `permissions`:

```json
    "updater:default",
    "process:default",
```

- [ ] **Step 4: Add the Settings control**

In `desktop/ui/settings.html`, inside the Progress section after the backup row:

```html
    <div class="row backup-row">
      <button type="button" id="updateBtn">Check for updates</button>
      <span class="hint" id="updateMsg"></span>
    </div>
```

In `desktop/ui/settings.js`, inside `init`:

```js
    // A local-first app should not phone home noisily: this runs once per
    // launch at most, and only ever reports back to this label.
    function checkUpdates(manual) {
      var msg = $('updateMsg');
      if (manual) msg.textContent = 'Checking…';
      return window.__TAURI__.updater.check().then(function (update) {
        if (!update) { if (manual) msg.textContent = 'You are on the latest version.'; return; }
        msg.textContent = 'Version ' + update.version + ' available — installing…';
        return update.downloadAndInstall().then(function () {
          return window.__TAURI__.process.relaunch();
        });
      }).catch(function (e) {
        if (manual) msg.textContent = 'Could not check: ' + e;
      });
    }

    $('updateBtn').addEventListener('click', function () { checkUpdates(true); });

    // Silent check on launch, at most once a day.
    var DAY = 24 * 60 * 60 * 1000;
    var lastCheck = parseInt(localStorage.getItem('kinvt.lastUpdateCheck') || '0', 10);
    if (Date.now() - lastCheck > DAY) {
      localStorage.setItem('kinvt.lastUpdateCheck', String(Date.now()));
      checkUpdates(false);
    }
```

- [ ] **Step 5: Add the release workflow**

Create `.github/workflows/release.yml`:

```yaml
name: Release

# Tag-driven so a release is always a deliberate act:
#   git tag v1.1.0 && git push origin v1.1.0
on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  release:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4

      - uses: dtolnay/rust-toolchain@stable

      - uses: swatinem/rust-cache@v2
        with:
          workspaces: desktop/tauri

      # Signs the bundle and publishes latest.json, which is the file the
      # updater endpoint in tauri.conf.json points at. Without both secrets
      # the build succeeds but produces no signature, and clients reject it.
      - uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          projectPath: desktop/tauri
          tagName: ${{ github.ref_name }}
          releaseName: 'Kinvt-study ${{ github.ref_name }}'
          releaseDraft: true
          includeUpdaterJson: true
```

- [ ] **Step 6: Document the key generation**

Append to `docs/DESKTOP_BUILD.md`:

```markdown
## Releasing an update

Updates are signed. Generate the keypair once:

```bash
cargo install tauri-cli --version "^2"
cargo tauri signer generate -w ~/.tauri/kinvt-study.key
```

That prints a public key and writes a private key. Then:

1. Paste the **public** key into `plugins.updater.pubkey` in
   `desktop/tauri/tauri.conf.json` and commit it.
2. Add two repository secrets under Settings → Secrets and variables → Actions:
   - `TAURI_SIGNING_PRIVATE_KEY` — the contents of `~/.tauri/kinvt-study.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the password you chose
3. Bump `version` in `desktop/tauri/tauri.conf.json` and `Cargo.toml`, then
   tag and push:

```bash
git tag v1.1.0 && git push origin v1.1.0
```

The Release workflow builds, signs, and opens a **draft** release. Publish it
and installed copies pick the update up within a day.

Keep the private key. Losing it means existing installs can never be updated
again — they will reject anything signed by a different key.
```

- [ ] **Step 7: Verify it compiles and degrades safely**

Run: `cd desktop/tauri && cargo build --release`
Expected: compiles clean. Launch and click **Check for updates**.
Expected: with the placeholder pubkey still in place it reports an error in the label and nothing else breaks — the quiz still works. That is the intended inert state until the real key is pasted in.

- [ ] **Step 8: Commit**

```bash
git add desktop/tauri/Cargo.toml desktop/tauri/src/main.rs desktop/tauri/tauri.conf.json desktop/tauri/capabilities/default.json desktop/ui/settings.html desktop/ui/settings.js .github/workflows/release.yml docs/DESKTOP_BUILD.md
git commit -m "Sign and ship updates from GitHub Releases"
```

---

### Task 12: CI

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `README.md` (documentation list)

**Interfaces:**
- Consumes: the test files from Tasks 1–3 and 7.
- Produces: nothing.

- [ ] **Step 1: Add the workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  content:
    name: Question banks and unit tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      # Without --require-source: the questions written before sources were
      # required would otherwise fail. Generated content is validated with the
      # flag on, in expand-library.yml.
      - name: Validate every question bank
        run: |
          fail=0
          for f in desktop/ui/data/*.json; do
            node scripts/validate-questions.mjs "$f" || fail=1
          done
          exit $fail

      - name: Unit tests
        run: node --test scripts/test/

  app:
    name: Tauri build
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: rustfmt, clippy
      - uses: swatinem/rust-cache@v2
        with:
          workspaces: desktop/tauri

      - name: Format
        working-directory: desktop/tauri
        run: cargo fmt --check

      - name: Clippy
        working-directory: desktop/tauri
        run: cargo clippy --release -- -D warnings

      - name: Build
        working-directory: desktop/tauri
        run: cargo build --release
```

- [ ] **Step 2: Make the checks pass locally first**

Run: `node --test scripts/test/`
Expected: all test files PASS.

Run: `cd desktop/tauri && cargo fmt && cargo clippy --release -- -D warnings`
Expected: clippy clean. Fix any warnings it reports rather than relaxing the flag; commit any formatting `cargo fmt` applies.

- [ ] **Step 3: Note it in the README**

In `README.md`, add to the Documentation list:

```markdown
- [docs/superpowers/specs/2026-08-16-app-improvements-design.md](docs/superpowers/specs/2026-08-16-app-improvements-design.md) — design behind adaptive selection, the progress dashboard, updates and DND.
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml README.md desktop/tauri
git commit -m "Run banks, unit tests, clippy and a release build on every push"
```

---

## Self-review

**Spec coverage:**

| Spec section | Task |
|---|---|
| 1 Module split | 1, 2, 3, 4 |
| 2 Adaptive difficulty | 3 (logic), 4 (wiring), 6 (toggle) |
| 3 Progress dashboard | 5 |
| 4 Validator + pipeline + source links | 7, 8 |
| 5 Auto-update | 11 |
| 6 Do-not-disturb | 9 |
| 7 Backup and export | 2 (payload logic), 10 (UI + I/O) |
| 8 CI | 12 |
| 9 Exam Prep content | separate plan — `2026-08-16-exam-prep-content.md` |

**Type consistency:** `topicBreakdown()` rows are `{id, answered, correct, accuracy}` in Task 2 and consumed with those names in Task 5. `pick(bank, count, opts)` is defined in Task 3 and called with `{adaptive, exclude}` in Task 4. `importPayload` returns `{ok, error}` in Task 2 and is destructured as `res.ok` / `res.error` in Task 10. `getSnoozeUntil`/`setSnoozeUntil` are defined in Task 4 and used in Task 9.

**Known ordering constraint:** Task 4 must land before Tasks 5, 6, 9 and 10, all of which call methods it adds to `KinvtQuiz`.

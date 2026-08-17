/*
 * Kinvt-study — everything the app remembers about how you are doing.
 *
 * Two accumulators, deliberately separate:
 *   recordResult  — the perfect-run streak, once per popup (onFinish)
 *   recordAnswer  — per question: device and topic counters, the rolling
 *                   window that drives difficulty, and the review queue
 *
 * Counters are kept per device so that two devices can merge without
 * double-counting; see merge.js for why summing cannot work.
 *
 * Retirement from review is by consecutive correct answers, not by a timer:
 * getting it right twice is evidence you know it; once could be a guess
 * between four options.
 */
(function (global) {
  'use strict';

  var S = global.KinvtStorage;
  var M = global.KinvtMerge;

  var RETIRE_AFTER = 2;     // consecutive correct answers to retire a question
  var RECENT_MAX = 30;      // rolling window that decides the difficulty band
  var MIN_ATTEMPTS = 5;     // below this, accuracy is noise rather than signal

  var DEFAULT_STATS = {
    schema: 2,
    deviceId: '',
    byDevice: {},
    byTopic: {},
    recent: [],
    streakByDevice: {}
  };

  function thisDevice() { return S.deviceId(global.KINVT_DEVICE_PREFIX || 'dsk'); }

  /* ---------- migration ----------
   * Schema 1 counted answers in flat totals, which cannot be merged between
   * devices without double-counting. Schema 2 attributes every count to the
   * device that earned it.
   *
   * This runs on read and is pure, so it can be tested against real v1 shapes.
   * Nothing is deleted: the stored payload is only replaced when a v2 write
   * happens, and this is the only copy of the user's history — there is no
   * server to restore it from.
   */
  function migrate(stats, deviceId, now) {
    // Require the shape, not just the version marker. Checking `schema` alone
    // is how v1 data gets mistaken for v2 the moment anything merges a default
    // object underneath it — and the result is a silent reset to zero.
    if (stats && stats.schema === 2 && stats.byDevice) return stats;

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

  /* ---------- reading and writing ---------- */

  function getStats() {
    // Read with an EMPTY fallback, never DEFAULT_STATS: `read` merges stored
    // values over the fallback, so passing defaults here would stamp
    // `schema: 2` onto a v1 payload and make it look already-migrated. The
    // defaults are applied below instead, after the schema has been decided.
    var st = migrate(S.read(S.KEYS.stats, {}), thisDevice(), Date.now());
    if (!st.byDevice || typeof st.byDevice !== 'object') st.byDevice = {};
    if (!st.byTopic || typeof st.byTopic !== 'object') st.byTopic = {};
    if (!Array.isArray(st.recent)) st.recent = [];
    if (!st.streakByDevice || typeof st.streakByDevice !== 'object') st.streakByDevice = {};
    return st;
  }

  function setStats(st) { S.write(S.KEYS.stats, st); }

  function getReview() {
    return migrateReview(S.read(S.KEYS.review, {}), thisDevice(), Date.now());
  }

  function setReview(r) { S.write(S.KEYS.review, r); }

  function resetStats() {
    var fresh = S.clone(DEFAULT_STATS);
    fresh.deviceId = thisDevice();
    setStats(fresh);
  }

  /* ---------- recording ---------- */

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
      if (!active) return;                    // never missed, or already retired
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
        retired: false,                        // a fresh miss revives it
        updatedAt: now,
        updatedBy: me
      };
    }
    setReview(review);
  }

  /* ---------- reading progress back ---------- */

  function activeReview() {
    var review = getReview();
    var out = {};
    Object.keys(review).forEach(function (id) {
      if (!review[id].retired) out[id] = review[id];
    });
    return out;
  }

  function reviewCount() { return Object.keys(activeReview()).length; }

  // Most-missed first: the questions that keep catching you out earn the slots.
  function pickReviewQuestions(bank, limit) {
    var review = activeReview();
    return bank
      .filter(function (q) { return review[q.id]; })
      .sort(function (a, b) { return (review[b.id].misses || 0) - (review[a.id].misses || 0); })
      .slice(0, Math.max(0, limit));
  }

  function topicAccuracy(topicId) {
    var t = M.topicTotals(getStats(), topicId);
    if (t.answered < MIN_ATTEMPTS) return null;
    return t.correct / t.answered;
  }

  function recentAccuracy() {
    var r = getStats().recent;
    if (r.length < MIN_ATTEMPTS) return null;
    return r.reduce(function (a, b) { return a + b; }, 0) / r.length;
  }

  // Weakest first, because that is the row worth acting on. Topics never
  // attempted carry a null accuracy and sort to the bottom rather than
  // pretending to be 0% and topping the list.
  function topicBreakdown() {
    var st = getStats();
    return Object.keys(st.byTopic).map(function (id) {
      var t = M.topicTotals(st, id);
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

  function streak() { return getStats().streakByDevice[thisDevice()] || 0; }

  /* ---------- backup and sync ----------
   * Import MERGES, and merging is idempotent: importing the same payload ten
   * times leaves exactly what importing it once did.
   *
   * An earlier version added the two sides' counters together, which was wrong
   * even for backups — restoring the same file twice doubled the answered
   * count — and would be fatal for sync, which repeats constantly.
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
    // A v1 payload predates device attribution, so everything in it is
    // credited to whichever device wrote it.
    var author = payload.deviceId || 'imported';
    var incomingStats = migrate(payload.stats, author, now);
    var incomingReview = migrateReview(payload.review || {}, author, now);

    setStats(M.mergeStats(getStats(), incomingStats));
    setReview(M.pruneTombstones(M.mergeReview(getReview(), incomingReview), now));

    if (payload.settings && typeof payload.settings === 'object') {
      S.write(S.KEYS.settings, M.mergeSettings(S.read(S.KEYS.settings, {}), payload.settings));
    }
    return { ok: true };
  }

  global.KinvtProgress = {
    DEFAULT_STATS: DEFAULT_STATS,
    RETIRE_AFTER: RETIRE_AFTER,
    RECENT_MAX: RECENT_MAX,
    MIN_ATTEMPTS: MIN_ATTEMPTS,
    thisDevice: thisDevice,
    migrate: migrate,
    migrateReview: migrateReview,
    getStats: getStats,
    setStats: setStats,
    resetStats: resetStats,
    getReview: getReview,
    recordResult: recordResult,
    recordAnswer: recordAnswer,
    reviewCount: reviewCount,
    pickReviewQuestions: pickReviewQuestions,
    topicAccuracy: topicAccuracy,
    recentAccuracy: recentAccuracy,
    topicBreakdown: topicBreakdown,
    streak: streak,
    exportPayload: exportPayload,
    importPayload: importPayload
  };
})(typeof window !== 'undefined' ? window : globalThis);

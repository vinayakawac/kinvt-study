/*
 * Kinvt-study — merging two devices' progress.
 *
 * Sync repeats. That single fact rules out the obvious merge — adding the two
 * sides' counters together — because adding is not idempotent: sync the same
 * data twice and the totals double.
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

  var TOMBSTONE_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

  // Which settings belong to the user and travel between devices, and which
  // belong to the device and stay put. Which topics you study is a fact about
  // you; how often a device interrupts you is a fact about that device.
  var SYNCED_SETTINGS = ['topics', 'adaptive', 'perQuiz'];

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
    return { answered: x.answered || 0, correct: Math.max(x.correct || 0, y.correct || 0) };
  }

  function mergeByDevice(a, b) {
    var out = {};
    Object.keys(a || {}).concat(Object.keys(b || {})).forEach(function (id) {
      if (out[id]) return;
      out[id] = moreAdvanced((a || {})[id], (b || {})[id]);
    });
    return out;
  }

  function mergeByTopic(a, b) {
    var out = {};
    Object.keys(a || {}).concat(Object.keys(b || {})).forEach(function (t) {
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
  // and averaging it with another device's would describe nobody.
  function mergeStats(local, remote) {
    var out = {};
    Object.keys(local || {}).forEach(function (k) { out[k] = local[k]; });
    out.schema = 2;
    out.byDevice = mergeByDevice((local || {}).byDevice, (remote || {}).byDevice);
    out.byTopic = mergeByTopic((local || {}).byTopic, (remote || {}).byTopic);
    return out;
  }

  /* ---------- review queue ----------
   * A review entry is a last-write-wins register: whichever device touched it
   * most recently knows the truth about it.
   *
   * Retirement is a TOMBSTONE rather than a delete. Deleting the key looks
   * correct on one device and fails completely under sync: the peer still has
   * the entry, so the next exchange puts it straight back and the question can
   * never stay retired. `retired: true` is a fact that merges; absence is not.
   */

  function laterOf(x, y) {
    var xa = x.updatedAt || 0;
    var ya = y.updatedAt || 0;
    if (ya > xa) return y;
    if (xa > ya) return x;
    // Identical timestamps must resolve the same way on both devices or they
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

  global.KinvtMerge = {
    TOMBSTONE_MAX_AGE_MS: TOMBSTONE_MAX_AGE_MS,
    SYNCED_SETTINGS: SYNCED_SETTINGS,
    mergeStats: mergeStats,
    mergeReview: mergeReview,
    mergeSettings: mergeSettings,
    pruneTombstones: pruneTombstones,
    totals: totals,
    topicTotals: topicTotals
  };
})(typeof window !== 'undefined' ? window : globalThis);

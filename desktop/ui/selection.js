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
    return Math.max(1, Math.min(MAX_WEIGHT, 1 + (1 - acc)));
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
    BAND_BONUS: BAND_BONUS,
    topicWeight: topicWeight,
    targetBand: targetBand,
    pick: pick
  };
})(typeof window !== 'undefined' ? window : globalThis);

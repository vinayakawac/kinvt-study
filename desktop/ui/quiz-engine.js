/*
 * Kinvt-study — settings, the question library, and building one quiz.
 *
 * The pieces that used to live here have moved to focused modules:
 *   storage.js    — persistence
 *   merge.js      — combining two devices' progress
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
    quietStart: 1320,     // 22:00, minutes since midnight
    quietEnd: 420,        // 07:00
    topics: {
      'general-knowledge': true,
      'upsc': true,
      'kpsc': true,
      'current-affairs': true,
      'ssc': false,
      'banking': false,
      'railways': false,
      'defence': false,
      'land-surveyor': false,
      'vao': false,
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

  // Stamped on every write so a sync can tell which side changed last.
  function setSettings(s) {
    s.updatedAt = Date.now();
    S.write(S.KEYS.settings, s);
  }

  function getSnoozeUntil() { return S.readNumber(S.KEYS.snoozeUntil); }
  function setSnoozeUntil(ts) { S.writeNumber(S.KEYS.snoozeUntil, ts); }

  function loadLibrary() {
    return fetch('library.json').then(function (r) { return r.json(); });
  }

  /* ---------- daily content sync ----------
   * Questions ship bundled so the app works offline, but a bundled bank only
   * changes when the app is reinstalled. Syncing from the public repo once a
   * day decouples content freshness from app releases.
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
    streak: P.streak,
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

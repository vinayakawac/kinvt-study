/*
 * Kinvt-study — shared quiz logic for the desktop app.
 *
 * This is the same behaviour the extension's background.js had (settings
 * defaults, topic filtering, shuffling, stats), minus everything that was
 * only there to work around browser-extension constraints: no tab hunting,
 * no script injection, no permission checks, no message passing. A native
 * window can simply draw itself.
 *
 * Settings and stats live in localStorage, which the webview persists
 * between runs, so Rust does not need to own any of it.
 */
(function (global) {
  'use strict';

  var SETTINGS_KEY = 'kinvt.settings';
  var STATS_KEY = 'kinvt.stats';

  var DEFAULT_SETTINGS = {
    enabled: true,
    intervalMin: 30,
    perQuiz: 3,
    durationSec: 45,
    theme: 'dark',
    glass: 'balanced',
    glassCustom: 70,
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

  var DEFAULT_STATS = { answered: 0, correct: 0, streak: 0 };

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return JSON.parse(JSON.stringify(fallback));
      var parsed = JSON.parse(raw);
      return Object.assign(JSON.parse(JSON.stringify(fallback)), parsed);
    } catch (e) {
      return JSON.parse(JSON.stringify(fallback));
    }
  }

  function getSettings() {
    var s = readJSON(SETTINGS_KEY, DEFAULT_SETTINGS);
    s.topics = Object.assign({}, DEFAULT_SETTINGS.topics, s.topics || {});
    return s;
  }

  function setSettings(s) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  }

  function getStats() { return readJSON(STATS_KEY, DEFAULT_STATS); }

  function recordResult(correct, total) {
    var st = getStats();
    st.answered += Math.max(0, total | 0);
    st.correct += Math.max(0, correct | 0);
    st.streak = (total > 0 && correct === total) ? st.streak + 1 : 0;
    localStorage.setItem(STATS_KEY, JSON.stringify(st));
    return st;
  }

  function resetStats() {
    localStorage.setItem(STATS_KEY, JSON.stringify(DEFAULT_STATS));
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function loadLibrary() {
    return fetch('library.json').then(function (r) { return r.json(); });
  }


  /* ---------- daily content sync ----------
   * Questions ship bundled so the app is fully functional offline, but a
   * bundled bank only changes when the app is reinstalled. Syncing from the
   * public repo once a day decouples content freshness from app releases:
   * push a question, every install picks it up within a day.
   *
   * Merged by `id` — same id updates that question, a new id adds one.
   * A failed fetch leaves the bundled copy untouched, so the library can
   * never end up empty.
   */

  var REMOTE_BASE = 'https://raw.githubusercontent.com/vinayakawac/kinvt-study/main/';
  var SYNC_KEY = 'kinvt.remoteLibrary';
  var SYNC_AT_KEY = 'kinvt.lastSyncAt';
  var SYNC_EVERY_MS = 24 * 60 * 60 * 1000;

  function getRemoteLibrary() { return readJSON(SYNC_KEY, {}); }

  function mergeById(bundled, remote) {
    if (!remote || !remote.length) return bundled;
    var map = new Map(bundled.map(function (q) { return [q.id, q]; }));
    remote.forEach(function (q) { map.set(q.id, q); });
    return Array.from(map.values());
  }

  function syncContent(force) {
    var last = parseInt(localStorage.getItem(SYNC_AT_KEY) || '0', 10);
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
        localStorage.setItem(SYNC_KEY, JSON.stringify(store));
        localStorage.setItem(SYNC_AT_KEY, String(Date.now()));
      }
      return updated;
    }).catch(function () { return false; });
  }


  /* ---------- spaced repetition ----------
   * A question you got wrong is the one worth seeing again. Missed ids are
   * recorded locally and a share of every popup is drawn from them, so
   * mistakes come back instead of being forgotten when the card closes.
   *
   * Retirement is by consecutive correct answers, not by a timer: getting it
   * right twice in a row is evidence you know it; getting it right once could
   * be a guess between four options.
   */

  var REVIEW_KEY = 'kinvt.review';
  var RETIRE_AFTER = 2;        // consecutive correct answers to drop it
  var REVIEW_SHARE = 0.5;      // at most half a popup is review material

  function getReview() { return readJSON(REVIEW_KEY, {}); }

  function recordAnswer(question, wasCorrect) {
    if (!question || !question.id) return;
    var review = getReview();
    var entry = review[question.id];

    if (wasCorrect) {
      if (!entry) return;                 // never missed — nothing to track
      entry.streak = (entry.streak || 0) + 1;
      if (entry.streak >= RETIRE_AFTER) delete review[question.id];
      else review[question.id] = entry;
    } else {
      review[question.id] = {
        misses: entry ? (entry.misses || 0) + 1 : 1,
        streak: 0,                        // a miss resets progress
        lastMissedAt: Date.now()
      };
    }
    localStorage.setItem(REVIEW_KEY, JSON.stringify(review));
  }

  function reviewCount() { return Object.keys(getReview()).length; }

  // Most-missed first: the questions that keep catching you out are the ones
  // worth the slots.
  function pickReviewQuestions(bank, limit) {
    var review = getReview();
    var due = bank
      .filter(function (q) { return review[q.id]; })
      .sort(function (a, b) { return (review[b.id].misses || 0) - (review[a.id].misses || 0); });
    return due.slice(0, limit);
  }

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

        shuffle(bank);
        var perQuiz = Math.max(1, Math.min(Math.round(settings.perQuiz) || 3, bank.length));

        // Reserve part of the popup for questions previously missed, then fill
        // the rest with fresh ones. Capped so a popup never becomes nothing
        // but review — new material still has to get through.
        var picked = [];
        if (settings.review !== false) {
          picked = pickReviewQuestions(bank, Math.floor(perQuiz * REVIEW_SHARE));
        }
        var chosenIds = {};
        picked.forEach(function (q) { chosenIds[q.id] = true; });
        for (var i = 0; i < bank.length && picked.length < perQuiz; i++) {
          if (!chosenIds[bank[i].id]) { picked.push(bank[i]); chosenIds[bank[i].id] = true; }
        }
        shuffle(picked);   // don't always lead with the review questions
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
    DEFAULT_STATS: DEFAULT_STATS,
    getSettings: getSettings,
    setSettings: setSettings,
    getStats: getStats,
    recordResult: recordResult,
    resetStats: resetStats,
    loadLibrary: loadLibrary,
    buildQuiz: buildQuiz,
    syncContent: syncContent,
    recordAnswer: recordAnswer,
    reviewCount: reviewCount,
    lastSyncAt: function () { return parseInt(localStorage.getItem(SYNC_AT_KEY) || '0', 10); }
  };
})(window);

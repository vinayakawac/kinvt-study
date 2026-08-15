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
          .then(function (d) { return { label: cat.label, questions: d.questions || [] }; })
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
        var title = labels.length <= 2
          ? labels.join(' · ')
          : labels.slice(0, 2).join(' · ') + ' +' + (labels.length - 2) + ' more';

        return {
          questions: bank.slice(0, perQuiz),
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
    buildQuiz: buildQuiz
  };
})(window);

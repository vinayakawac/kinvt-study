// chrome.storage.local wrappers for settings and stats. Loaded as a plain
// script alongside browser-api.js and categories.js.
(function (global) {
  const api = global.QuizPop.api;
  const CATEGORIES = global.QuizPop.CATEGORIES;

  const DEFAULT_SETTINGS = {
    selectedCategories: CATEGORIES.map((c) => c.id),
    autoPopupEnabled: true,
    intervalMinutes: 30,
  };

  const DEFAULT_STATS = {
    correctCount: 0,
    incorrectCount: 0,
    currentStreak: 0,
    bestStreak: 0,
    lastAnsweredAt: 0,
  };

  function getSettings() {
    return api.storage.local.get("settings").then((res) => ({
      ...DEFAULT_SETTINGS,
      ...(res.settings || {}),
    }));
  }

  function setSettings(partial) {
    return getSettings().then((current) => {
      const next = { ...current, ...partial };
      return api.storage.local.set({ settings: next }).then(() => next);
    });
  }

  function getStats() {
    return api.storage.local.get("stats").then((res) => ({
      ...DEFAULT_STATS,
      ...(res.stats || {}),
    }));
  }

  function recordAnswer(isCorrect) {
    return getStats().then((stats) => {
      const next = { ...stats };
      if (isCorrect) {
        next.correctCount += 1;
        next.currentStreak += 1;
        next.bestStreak = Math.max(next.bestStreak, next.currentStreak);
      } else {
        next.incorrectCount += 1;
        next.currentStreak = 0;
      }
      next.lastAnsweredAt = Date.now();
      return api.storage.local.set({ stats: next }).then(() => next);
    });
  }

  function resetStats() {
    return api.storage.local.set({ stats: { ...DEFAULT_STATS } });
  }

  global.QuizPop.storage = {
    DEFAULT_SETTINGS,
    DEFAULT_STATS,
    getSettings,
    setSettings,
    getStats,
    recordAnswer,
    resetStats,
  };
})(typeof self !== "undefined" ? self : globalThis);

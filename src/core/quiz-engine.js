// Loads and filters the bundled question bank. Runs only in extension-context
// scripts (popup, options, service worker) — never injected into a page.
(function (global) {
  const api = global.QuizPop.api;
  const CATEGORIES = global.QuizPop.CATEGORIES;

  const bankCache = new Map();

  function loadCategoryFile(category) {
    if (bankCache.has(category.id)) {
      return Promise.resolve(bankCache.get(category.id));
    }
    const url = api.runtime.getURL(category.file);
    return fetch(url)
      .then((res) => res.json())
      .then((questions) => {
        bankCache.set(category.id, questions);
        return questions;
      })
      .catch(() => []);
  }

  function mergeById(bundled, remote) {
    if (!remote || !remote.length) return bundled;
    const merged = new Map(bundled.map((q) => [q.id, q]));
    remote.forEach((q) => merged.set(q.id, q));
    return Array.from(merged.values());
  }

  function loadQuestionBank(categoryIds) {
    const wanted = CATEGORIES.filter((c) => categoryIds.includes(c.id));
    return Promise.all([
      Promise.all(wanted.map(loadCategoryFile)),
      api.storage.local.get("remoteBank").then((res) => res.remoteBank || {}),
    ]).then(([bundledLists, remoteBank]) => {
      return wanted.flatMap((cat, i) => mergeById(bundledLists[i], remoteBank[cat.id]?.questions));
    });
  }

  function pickRandomQuestion(bank, avoidId) {
    if (!bank.length) return null;
    if (bank.length === 1) return bank[0];
    let question = bank[Math.floor(Math.random() * bank.length)];
    if (avoidId) {
      let attempts = 0;
      while (question.id === avoidId && attempts < 5) {
        question = bank[Math.floor(Math.random() * bank.length)];
        attempts += 1;
      }
    }
    return question;
  }

  global.QuizPop.quizEngine = {
    loadQuestionBank,
    pickRandomQuestion,
  };
})(typeof self !== "undefined" ? self : globalThis);

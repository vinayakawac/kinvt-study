// Background content sync: pulls the latest question-bank JSON from a public
// GitHub repo (raw.githubusercontent.com) once a day and merges it into the
// bundled bank. No user interaction required — the host is declared as a
// fixed manifest permission, granted at install, so no runtime prompt is
// needed. If a fetch fails (offline, repo unreachable), the bundled JSON
// bundled with the extension is always used as a fallback.
(function (global) {
  const api = global.QuizPop.api;
  const CATEGORIES = global.QuizPop.CATEGORIES;

  const REMOTE_BASE = "https://raw.githubusercontent.com/vinayakawac/kinvt-study/main/";

  function fetchRemoteCategory(category) {
    const url = REMOTE_BASE + category.file + "?cb=" + Date.now();
    return fetch(url, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((questions) => (Array.isArray(questions) ? questions : null))
      .catch(() => null);
  }

  function syncAll() {
    return Promise.all(CATEGORIES.map((cat) => fetchRemoteCategory(cat).then((questions) => ({ id: cat.id, questions }))))
      .then((results) => {
        return api.storage.local.get("remoteBank").then((res) => {
          const remoteBank = res.remoteBank || {};
          let updatedAny = false;
          results.forEach(({ id, questions }) => {
            if (questions) {
              remoteBank[id] = { questions, updatedAt: Date.now() };
              updatedAny = true;
            }
          });
          if (!updatedAny) return false;
          return api.storage.local.set({ remoteBank, lastSyncAt: Date.now() }).then(() => true);
        });
      })
      .catch(() => false);
  }

  global.QuizPop.contentSync = { syncAll };
})(typeof self !== "undefined" ? self : globalThis);

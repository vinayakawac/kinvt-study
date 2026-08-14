// Stubs the subset of the chrome/browser extension API this project uses,
// so popup.js / options.js can run unmodified in a plain browser tab for
// visual/behavioral testing. Backed by localStorage instead of
// chrome.storage.local. NOT part of the shipped extension.
(function () {
  const listeners = [];

  function readLocal() {
    try {
      return JSON.parse(localStorage.getItem("quizpop-mock-storage") || "{}");
    } catch (e) {
      return {};
    }
  }

  function writeLocal(obj) {
    localStorage.setItem("quizpop-mock-storage", JSON.stringify(obj));
  }

  window.chrome = {
    runtime: {
      getURL: (p) => "../src/" + p,
      openOptionsPage: () => {
        window.location.href = "options-preview.html";
      },
      onMessage: { addListener: () => {} },
      onInstalled: { addListener: () => {} },
      onStartup: { addListener: () => {} },
      sendMessage: () => Promise.resolve({ ok: true }),
    },
    storage: {
      local: {
        get: (key) => {
          const all = readLocal();
          if (typeof key === "string") return Promise.resolve({ [key]: all[key] });
          return Promise.resolve(all);
        },
        set: (obj) => {
          const all = readLocal();
          Object.assign(all, obj);
          writeLocal(all);
          listeners.forEach((fn) => fn(obj, "local"));
          return Promise.resolve();
        },
      },
      onChanged: {
        addListener: (fn) => listeners.push(fn),
      },
    },
    permissions: {
      contains: () => Promise.resolve(true),
      request: () => Promise.resolve(true),
    },
    alarms: {
      create: () => {},
      clear: () => Promise.resolve(),
      onAlarm: { addListener: () => {} },
    },
    scripting: {
      executeScript: () => Promise.resolve(),
    },
    tabs: {
      query: () => Promise.resolve([{ id: 1 }]),
    },
  };
})();

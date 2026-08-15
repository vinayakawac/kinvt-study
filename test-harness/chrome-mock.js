// Stubs the extension API surface Kinvt-study uses, so its real,
// unmodified source files (background.js, sidepanel.js, ui-core.js,
// overlay.js) can run in a plain browser tab for visual/behavioral testing.
// storage.local/session are backed by two separate in-memory+localStorage
// maps, matching the real two-namespace behavior. NOT part of the shipped
// extension.
(function () {
  const listeners = { changed: [], installed: [], startup: [], message: [], actionClicked: [] };
  const sessionStore = {}; // storage.session has no persistence guarantee; plain memory is fine

  function readLocal() {
    try {
      return JSON.parse(localStorage.getItem("tpq-mock-storage") || "{}");
    } catch (e) {
      return {};
    }
  }
  function writeLocal(obj) {
    localStorage.setItem("tpq-mock-storage", JSON.stringify(obj));
  }

  function makeGetter(store) {
    return function (query) {
      let keys;
      let defaults = {};
      if (typeof query === "string") keys = [query];
      else if (Array.isArray(query)) keys = query;
      else if (query && typeof query === "object") {
        keys = Object.keys(query);
        defaults = query;
      } else keys = null;

      const result = {};
      const source = store === "local" ? readLocal() : sessionStore;
      const allKeys = keys || Object.keys({ ...defaults, ...source });
      allKeys.forEach((k) => {
        result[k] = k in source ? source[k] : defaults[k];
      });
      return Promise.resolve(result);
    };
  }

  function makeSetter(store) {
    return function (obj) {
      if (store === "local") {
        const all = readLocal();
        Object.assign(all, obj);
        writeLocal(all);
        listeners.changed.forEach((fn) => {
          const changes = {};
          Object.keys(obj).forEach((k) => (changes[k] = { newValue: obj[k] }));
          fn(changes, "local");
        });
      } else {
        Object.assign(sessionStore, obj);
      }
      return Promise.resolve();
    };
  }

  function makeRemover(store) {
    return function (key) {
      const keys = Array.isArray(key) ? key : [key];
      if (store === "local") {
        const all = readLocal();
        keys.forEach((k) => delete all[k]);
        writeLocal(all);
      } else {
        keys.forEach((k) => delete sessionStore[k]);
      }
      return Promise.resolve();
    };
  }

  const alarmsStore = new Map();

  window.chrome = {
    runtime: {
      id: "mock-extension-id",
      getURL: (p) => "../src/" + p,
      onInstalled: { addListener: (fn) => listeners.installed.push(fn) },
      onStartup: { addListener: (fn) => listeners.startup.push(fn) },
      onMessage: { addListener: (fn) => listeners.message.push(fn) },
      sendMessage: (msg) => {
        // Mirrors real chrome.runtime.sendMessage: resolves undefined only
        // when there's truly no listener to respond (e.g. no background
        // page loaded in this harness page) — not merely because the one
        // listener that exists happens to answer asynchronously. Real
        // Chrome keeps the message channel open indefinitely once a
        // listener returns `true` (which background.js's does); resolving
        // early here previously made every BUILD_QUIZ/GET_PENDING_QUIZ
        // round-trip look like "no listener" even with background.js loaded.
        if (!listeners.message.length) return Promise.resolve(undefined);
        return new Promise((resolve) => {
          let responded = false;
          const sendResponse = (res) => {
            if (responded) return;
            responded = true;
            resolve(res);
          };
          listeners.message.forEach((fn) => fn(msg, {}, sendResponse));
        });
      },
    },
    storage: {
      local: {
        get: makeGetter("local"),
        set: makeSetter("local"),
        remove: makeRemover("local"),
      },
      session: {
        get: makeGetter("session"),
        set: makeSetter("session"),
        remove: makeRemover("session"),
      },
      onChanged: { addListener: (fn) => listeners.changed.push(fn) },
    },
    alarms: {
      create: (name, opts) => alarmsStore.set(name, opts),
      get: (name) => Promise.resolve(alarmsStore.get(name)),
      clear: (name) => {
        alarmsStore.delete(name);
        return Promise.resolve(true);
      },
      onAlarm: { addListener: () => {} },
    },
    tabs: {
      // `url` is only present when the covering host permission is actually
      // granted — mirror that, so the Firefox-MV3 case (declared but not yet
      // granted, so `url` is undefined) is reachable in tests by setting
      // window.__tpqMockHostGranted = false before calling.
      query: () =>
        Promise.resolve([
          window.__tpqMockHostGranted === false
            ? { id: 1 }
            : { id: 1, url: "https://example.com" },
        ]),
    },
    permissions: {
      contains: () => Promise.resolve(window.__tpqMockHostGranted !== false),
      request: () => {
        window.__tpqMockHostGranted = true;
        return Promise.resolve(true);
      },
    },
    scripting: {
      // Mirrors the real API's shape closely enough to exercise the
      // func+args injection path: `files` is a no-op here (the harness page
      // already loads those scripts itself), while `func` is actually
      // invoked with `args` and its return value wrapped in the
      // [{result}] array real Chrome/Firefox hand back.
      executeScript: (opts) => {
        console.log("[mock] scripting.executeScript", opts);
        if (typeof opts.func === "function") {
          const result = opts.func.apply(null, opts.args || []);
          return Promise.resolve([{ result }]);
        }
        return Promise.resolve([{ result: undefined }]);
      },
    },
    windows: {
      create: (opts) => {
        console.log("[mock] windows.create", opts);
        return Promise.resolve({ id: 1 });
      },
      getLastFocused: () => Promise.resolve({ id: 1, type: "normal", focused: true }),
    },
    action: {
      onClicked: { addListener: (fn) => listeners.actionClicked.push(fn) },
    },
    sidePanel: undefined, // simulate Chrome < 114 / Firefox path in some tests
  };

  window.__tpqMock = { listeners, alarmsStore, readLocal, writeLocal };
})();

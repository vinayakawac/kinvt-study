/*
 * Stubs window.__TAURI__ so the frontend can be exercised in a plain browser,
 * without the Rust shell. Only what the UI actually calls is stubbed:
 * invoke() logs, and the event bus is a real in-page pub/sub so
 * "start-quiz" genuinely wires the settings button to the quiz window.
 * NOT shipped — dev only.
 */
(function () {
  var handlers = {};
  window.__TAURI_PREVIEW_CALLS__ = [];

  window.__TAURI__ = {
    core: {
      invoke: function (cmd, args) {
        window.__TAURI_PREVIEW_CALLS__.push({ cmd: cmd, args: args });
        return Promise.resolve();
      }
    },
    event: {
      listen: function (name, cb) {
        (handlers[name] = handlers[name] || []).push(cb);
        return Promise.resolve(function () {});
      },
      emit: function (name, payload) {
        (handlers[name] || []).forEach(function (cb) { cb({ payload: payload }); });
        return Promise.resolve();
      }
    }
  };
})();

// Shared cross-browser API shim. Loaded as a plain (non-module) script in every
// extension surface (service worker, popup, options). Firefox exposes the
// promise-based `browser` namespace natively; Chrome MV3 also promisifies most
// `chrome.*` calls, so picking whichever global exists is enough without a
// full polyfill for the calls this extension makes.
(function (global) {
  const api = typeof global.browser !== "undefined" ? global.browser : global.chrome;
  global.QuizPop = global.QuizPop || {};
  global.QuizPop.api = api;
})(typeof self !== "undefined" ? self : globalThis);

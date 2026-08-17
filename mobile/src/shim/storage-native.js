/*
 * Kinvt-study — Android storage backend.
 *
 * Capacitor Preferences writes to SharedPreferences, which survives what the
 * webview's localStorage does not: storage pressure, cache clearing, and the
 * user tapping "Clear cache" in app settings. Progress exists nowhere else —
 * there is no server to restore it from — so this is not an optimisation.
 *
 * Loads before every other module so the cache is hydrating while they parse.
 */
(function (global) {
  'use strict';
  var P = global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.Preferences;
  if (!P || !global.KinvtStorage) return;

  global.KinvtStorage.setBackend({
    getItem: function (key) { return P.get({ key: key }).then(function (r) { return r.value; }); },
    setItem: function (key, value) { return P.set({ key: key, value: value }); },
    removeItem: function (key) { return P.remove({ key: key }); }
  });
})(typeof window !== 'undefined' ? window : globalThis);

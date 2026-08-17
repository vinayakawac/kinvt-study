/*
 * Kinvt-study — the one place that touches persistent storage.
 *
 * Split out of quiz-engine.js so that stats, spaced repetition and adaptive
 * selection can each be read and tested without dragging the whole engine
 * (and its fetches) along with them.
 *
 * `read` merges stored values over a fallback, so an object written by an
 * older version is transparently topped up with newly added fields — that is
 * what lets new settings appear without a migration step.
 *
 * The backend is pluggable. The desktop uses localStorage; Android cannot,
 * because the system can clear webview data under storage pressure and the
 * review history exists nowhere else. Reads stay synchronous against an
 * in-memory cache either way, because progress.js and selection.js read on
 * hot paths and making them async would ripple out to the quiz card itself.
 */
(function (global) {
  'use strict';

  var KEYS = {
    settings: 'kinvt.settings',
    stats: 'kinvt.stats',
    review: 'kinvt.review',
    remote: 'kinvt.remoteLibrary',
    syncAt: 'kinvt.lastSyncAt',
    snoozeUntil: 'kinvt.snoozeUntil',
    deviceId: 'kinvt.deviceId',
    peers: 'kinvt.peers'
  };

  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  /* ---------- pluggable backend ---------- */

  var backend = null;
  var cache = null;
  var readyPromise = Promise.resolve();

  function setBackend(b) {
    backend = b;
    cache = {};
    readyPromise = Promise.all(Object.keys(KEYS).map(function (name) {
      var key = KEYS[name];
      return Promise.resolve(backend.getItem(key)).then(function (v) {
        if (v !== null && v !== undefined) cache[key] = String(v);
      });
    })).then(function () { return undefined; });
  }

  function ready() { return readyPromise; }

  function rawGet(key) {
    if (backend) return Object.prototype.hasOwnProperty.call(cache, key) ? cache[key] : null;
    try { return global.localStorage.getItem(key); } catch (e) { return null; }
  }

  function rawSet(key, value) {
    if (backend) {
      cache[key] = value;
      // Not awaited: a slow or failing write must not stall the quiz. The
      // value is already in the cache, so this session is unaffected, and the
      // next write retries implicitly.
      Promise.resolve(backend.setItem(key, value)).catch(function () { /* noop */ });
      return true;
    }
    try { global.localStorage.setItem(key, value); return true; } catch (e) { return false; }
  }

  /* ---------- typed accessors ---------- */

  function read(key, fallback) {
    try {
      var raw = rawGet(key);
      if (!raw) return clone(fallback);
      return Object.assign(clone(fallback), JSON.parse(raw));
    } catch (e) {
      // Corrupt or unreadable storage must never take the app down; the
      // fallback is always a usable value.
      return clone(fallback);
    }
  }

  function write(key, value) {
    try { return rawSet(key, JSON.stringify(value)); } catch (e) { return false; }
  }

  function readNumber(key) {
    var v = parseInt(rawGet(key) || '0', 10);
    return isNaN(v) ? 0 : v;
  }

  function writeNumber(key, n) { rawSet(key, String(n)); }

  /* ---------- device identity ----------
   * Sync needs to attribute counters to the device that earned them, so each
   * install carries a short random id. It is not an account and holds no
   * personal data: it exists only so two devices can tell their own
   * contributions apart when merging.
   */
  function deviceId(prefix) {
    var existing = rawGet(KEYS.deviceId);
    if (existing) return existing;

    var bytes = new Uint8Array(3);
    global.crypto.getRandomValues(bytes);
    var id = (prefix || 'dev') + '-' + Array.prototype.map
      .call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); })
      .join('');

    rawSet(KEYS.deviceId, id);
    return id;
  }

  global.KinvtStorage = {
    KEYS: KEYS,
    read: read,
    write: write,
    readNumber: readNumber,
    writeNumber: writeNumber,
    clone: clone,
    deviceId: deviceId,
    setBackend: setBackend,
    ready: ready
  };
})(typeof window !== 'undefined' ? window : globalThis);

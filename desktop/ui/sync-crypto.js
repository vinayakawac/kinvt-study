/*
 * Kinvt-study — the sync wire format.
 *
 * There is no server and no account, so there is no identity provider to lean
 * on. The trust comes from somewhere better: the key is generated fresh on the
 * desktop and handed to the phone THROUGH A CAMERA. It never travels over the
 * network at all, which is what makes plain HTTP an acceptable transport here
 * — the payload inside it is already end-to-end encrypted.
 *
 * AES-256-GCM is used because it authenticates as well as encrypts. A wrong
 * key, a flipped bit, or a rewritten field all fail the authentication tag, so
 * `open` either returns exactly what was sealed or throws. There is no middle
 * case to reason about.
 *
 * This file is loaded by BOTH devices. One implementation cannot disagree
 * with itself.
 */
(function (global) {
  'use strict';

  var WIRE_VERSION = 1;
  var MAX_SKEW_MS = 5 * 60 * 1000;
  var NONCE_BYTES = 12;              // 96 bits, the size GCM is defined for
  var KEY_BYTES = 32;                // AES-256

  function toB64u(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return global.btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromB64u(s) {
    var b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    var bin = global.atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function newKey() {
    var k = new Uint8Array(KEY_BYTES);
    global.crypto.getRandomValues(k);
    return Promise.resolve(k);
  }

  function importKey(bytes) {
    return global.crypto.subtle.importKey(
      'raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']
    );
  }

  function encodeUtf8(s) {
    if (global.TextEncoder) return new global.TextEncoder().encode(s);
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  }

  function decodeUtf8(bytes) {
    if (global.TextDecoder) return new global.TextDecoder().decode(bytes);
    var s = '', i = 0;
    while (i < bytes.length) {
      var c = bytes[i++];
      if (c < 0x80) s += String.fromCharCode(c);
      else if (c < 0xe0) s += String.fromCharCode(((c & 31) << 6) | (bytes[i++] & 63));
      else s += String.fromCharCode(((c & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63));
    }
    return s;
  }

  // `ts` is a parameter rather than read from the clock, so staleness is
  // directly testable.
  function seal(keyBytes, obj, ts) {
    var nonce = new Uint8Array(NONCE_BYTES);
    global.crypto.getRandomValues(nonce);
    var body = encodeUtf8(JSON.stringify({ ts: ts || Date.now(), body: obj }));

    return importKey(keyBytes).then(function (key) {
      return global.crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, body);
    }).then(function (ct) {
      return { v: WIRE_VERSION, nonce: toB64u(nonce), ct: toB64u(new Uint8Array(ct)) };
    });
  }

  function open(keyBytes, env) {
    if (!env || env.v !== WIRE_VERSION || !env.nonce || !env.ct) {
      return Promise.reject(new Error('unsupported wire version'));
    }
    return importKey(keyBytes).then(function (key) {
      return global.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromB64u(env.nonce) }, key, fromB64u(env.ct)
      );
    }).then(function (plain) {
      var msg = JSON.parse(decodeUtf8(new Uint8Array(plain)));
      // A replayed message is authentic — it was sealed with the real key —
      // so only its age gives it away.
      if (Math.abs(Date.now() - (msg.ts || 0)) > MAX_SKEW_MS) {
        throw new Error('message is stale');
      }
      return msg.body;
    });
  }

  global.KinvtSyncCrypto = {
    WIRE_VERSION: WIRE_VERSION,
    MAX_SKEW_MS: MAX_SKEW_MS,
    KEY_BYTES: KEY_BYTES,
    newKey: newKey,
    seal: seal,
    open: open,
    toB64u: toB64u,
    fromB64u: fromB64u
  };
})(typeof window !== 'undefined' ? window : globalThis);

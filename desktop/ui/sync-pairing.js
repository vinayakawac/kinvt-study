/*
 * Kinvt-study — pairing, and remembering the devices you have paired with.
 *
 * The pairing URL is what the QR code contains. It carries the key, so it is
 * never logged, never copied to the clipboard and never put in a page title,
 * and it expires quickly: someone who photographs the screen over your
 * shoulder has a couple of minutes at most, and the listener has closed by
 * then anyway.
 *
 * Once paired, the key is stored so later syncs need no scan. That key is
 * therefore at rest in app storage, and is exactly as protected as the device
 * itself — which is why "Forget device" exists.
 */
(function (global) {
  'use strict';

  var S = global.KinvtStorage;
  var C = global.KinvtSyncCrypto;

  var SCHEME = 'kinvt1://';
  var PAIRING_TTL_MS = 2 * 60 * 1000;

  function buildUrl(o) {
    return SCHEME + o.host + ':' + o.port + '/?k=' + C.toB64u(o.key) +
      '&d=' + encodeURIComponent(o.deviceId) + '&e=' + o.expiresAt;
  }

  function parseUrl(url, now) {
    var s = String(url || '');
    if (s.indexOf(SCHEME) !== 0) throw new Error('not a Kinvt pairing code (bad scheme)');

    var rest = s.slice(SCHEME.length);
    var q = rest.indexOf('?');
    if (q === -1) throw new Error('pairing code has no key');

    var hostPort = rest.slice(0, q).replace(/\/$/, '');
    var colon = hostPort.lastIndexOf(':');
    if (colon === -1) throw new Error('pairing code has no port');

    var params = {};
    rest.slice(q + 1).split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0) params[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
    });

    if (!params.k) throw new Error('pairing code has no key');
    if (!params.d) throw new Error('pairing code has no device id');

    var key = C.fromB64u(params.k);
    if (key.length !== C.KEY_BYTES) throw new Error('pairing key is the wrong length');

    var expiresAt = parseInt(params.e, 10) || 0;
    if ((now || Date.now()) > expiresAt) {
      throw new Error('pairing code has expired — show a new one');
    }

    return {
      host: hostPort.slice(0, colon),
      port: parseInt(hostPort.slice(colon + 1), 10),
      key: key,
      deviceId: params.d,
      expiresAt: expiresAt
    };
  }

  function allPeers() { return S.read(S.KEYS.peers, {}); }

  function savePeer(deviceId, keyBytes, name) {
    var peers = allPeers();
    peers[deviceId] = {
      key: C.toB64u(keyBytes),
      name: name || deviceId,
      lastSyncAt: (peers[deviceId] && peers[deviceId].lastSyncAt) || 0
    };
    S.write(S.KEYS.peers, peers);
  }

  function getPeer(deviceId) {
    var p = allPeers()[deviceId];
    if (!p) return null;
    return { deviceId: deviceId, key: C.fromB64u(p.key), name: p.name, lastSyncAt: p.lastSyncAt || 0 };
  }

  function listPeers() {
    var peers = allPeers();
    return Object.keys(peers).map(function (id) {
      return { deviceId: id, name: peers[id].name, lastSyncAt: peers[id].lastSyncAt || 0 };
    });
  }

  function forgetPeer(deviceId) {
    var peers = allPeers();
    delete peers[deviceId];
    S.write(S.KEYS.peers, peers);
  }

  function touchPeer(deviceId, at) {
    var peers = allPeers();
    if (!peers[deviceId]) return;
    peers[deviceId].lastSyncAt = at;
    S.write(S.KEYS.peers, peers);
  }

  global.KinvtPairing = {
    SCHEME: SCHEME,
    PAIRING_TTL_MS: PAIRING_TTL_MS,
    buildUrl: buildUrl,
    parseUrl: parseUrl,
    savePeer: savePeer,
    getPeer: getPeer,
    listPeers: listPeers,
    forgetPeer: forgetPeer,
    touchPeer: touchPeer
  };
})(typeof window !== 'undefined' ? window : globalThis);

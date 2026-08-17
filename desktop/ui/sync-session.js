/*
 * Kinvt-study — one sync conversation.
 *
 * Deliberately transport-free. `handleRequest` takes an envelope and returns
 * an envelope; `syncWith` takes a function that moves an envelope and brings
 * one back. Sockets, Rust listeners and fetch all live outside this file.
 *
 * That is what lets the whole protocol — two devices converging, a repeated
 * sync changing nothing, an attacker being rejected — be tested in one process
 * with no network at all.
 */
(function (global) {
  'use strict';

  var C = global.KinvtSyncCrypto;
  var P = global.KinvtProgress;
  var Pair = global.KinvtPairing;

  var PAYLOAD_VERSION = 2;

  function localPayload() {
    return P.exportPayload();          // {version: 2, stats, review, settings}
  }

  function applyRemote(payload) {
    return P.importPayload(payload);   // merges; idempotent by construction
  }

  /* The listener's entire decision-making. `findKey(deviceId)` returns the
   * shared key for a known peer, or null.
   *
   * Failures are deliberately uninformative: an unknown device and a wrong key
   * both give 401 with no body, so a prober cannot learn which device ids are
   * paired or whether a key was close.
   */
  function handleRequest(envelope, findKey) {
    if (!envelope || envelope.v !== C.WIRE_VERSION || !envelope.nonce || !envelope.ct) {
      return Promise.resolve({ status: 400 });
    }

    // The device id travels outside the ciphertext, so it cannot be trusted —
    // it only selects which key to TRY. Authentication is the GCM tag.
    var key = findKey(envelope.d);
    if (!key) return Promise.resolve({ status: 401 });

    return C.open(key, envelope).then(function (req) {
      if (!req || !req.payload || req.payload.version !== PAYLOAD_VERSION) {
        return { status: 422 };
      }
      var res = applyRemote(req.payload);
      if (!res.ok) return { status: 422 };

      return C.seal(key, {
        deviceId: P.thisDevice(),
        payload: localPayload()
      }).then(function (out) {
        out.d = P.thisDevice();
        return { status: 200, envelope: out };
      });
    }).catch(function () {
      // A wrong key, tampering, or a stale timestamp all land here. No detail
      // is returned, because the difference is only useful to an attacker.
      return { status: 401 };
    });
  }

  function syncWith(peer, transport) {
    var url = 'http://' + peer.host + ':' + peer.port + '/v1/sync';
    var me = P.thisDevice();

    return C.seal(peer.key, { deviceId: me, payload: localPayload() })
      .then(function (envelope) {
        envelope.d = me;
        return transport(url, envelope);
      })
      .then(function (reply) { return C.open(peer.key, reply); })
      .then(function (msg) {
        if (!msg || !msg.payload) throw new Error('the other device sent nothing usable');
        var res = applyRemote(msg.payload);
        if (!res.ok) throw new Error(res.error);
        if (peer.deviceId) Pair.touchPeer(peer.deviceId, Date.now());
        return { ok: true };
      })
      .catch(function (e) {
        return { ok: false, error: 'could not sync: ' + (e && e.message ? e.message : e) };
      });
  }

  global.KinvtSync = {
    PAYLOAD_VERSION: PAYLOAD_VERSION,
    localPayload: localPayload,
    applyRemote: applyRemote,
    handleRequest: handleRequest,
    syncWith: syncWith
  };
})(typeof window !== 'undefined' ? window : globalThis);

/*
 * Kinvt-study — pairing and syncing from the phone.
 *
 * The camera is the security boundary here: scanning the code is what proves
 * the two devices are in the same room, which is why the key can travel that
 * way and never over the network. Everything after that is ciphertext.
 */
(function (global) {
  'use strict';
  var Scanner = global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.BarcodeScanner;
  if (!Scanner) return;

  function transport(url, envelope) {
    return fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope)
    }).then(function (r) {
      if (!r.ok) throw new Error('the other device refused the sync (' + r.status + ')');
      return r.json();
    });
  }

  function pair() {
    return Scanner.requestPermissions()
      .then(function (p) {
        if (p.camera !== 'granted') throw new Error('camera permission is needed to scan the code');
        return Scanner.scan({ formats: ['QR_CODE'] });
      })
      .then(function (result) {
        var raw = result && result.barcodes && result.barcodes[0] && result.barcodes[0].rawValue;
        if (!raw) throw new Error('no code found');
        // Throws on a foreign scheme, a bad key length, or an expired code.
        var peer = global.KinvtPairing.parseUrl(raw);
        global.KinvtPairing.savePeer(peer.deviceId, peer.key, 'Desktop');
        return global.KinvtSync.syncWith(peer, transport);
      });
  }

  global.KinvtScan = { pair: pair, transport: transport };
})(typeof window !== 'undefined' ? window : globalThis);

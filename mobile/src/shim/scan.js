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

  /*
   * scan() hands off to Google's scanner UI, which ships as an on-demand Play
   * Services module rather than inside the APK. On a device that has never
   * used a scanner it is simply absent, and scan() fails with "The Google
   * Barcode Scanner Module is not available" — which is what happened on a
   * clean emulator image the first time this was wired up.
   *
   * So availability is checked and the module fetched before scanning. This is
   * the one moment the app touches the network outside the daily question
   * sync, it happens once per device, and it happens only if the user chose to
   * pair. onProgress lets the caller say so rather than appear frozen behind a
   * silent download.
   */
  function ensureScanner(onProgress) {
    if (!Scanner.isGoogleBarcodeScannerModuleAvailable) return Promise.resolve();
    return Scanner.isGoogleBarcodeScannerModuleAvailable().then(function (r) {
      if (r && r.available) return null;
      if (onProgress) onProgress();
      return Scanner.installGoogleBarcodeScannerModule().catch(function () {
        throw new Error('the QR scanner could not be installed — check the connection and Play Services');
      });
    });
  }

  function pair(onProgress) {
    return Scanner.requestPermissions()
      .then(function (p) {
        if (p.camera !== 'granted') throw new Error('camera permission is needed to scan the code');
        return ensureScanner(onProgress);
      })
      .then(function () { return Scanner.scan({ formats: ['QR_CODE'] }); })
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

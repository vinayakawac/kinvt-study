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

  /*
   * The sync request goes through native HTTP rather than the webview's fetch,
   * and it has to.
   *
   * Capacitor serves the app from https://localhost, so a plain fetch() to a
   * peer at http://192.168.x.x is active mixed content and Chromium blocks it
   * outright — before Android's own cleartext policy even gets a say. Both had
   * to be fixed; the manifest's network security config handles the second.
   *
   * The two obvious ways out are both wrong here:
   *
   *   androidScheme: 'http'        drops the app to an insecure origin, which
   *                                takes crypto.subtle with it — and the sync
   *                                envelope is encrypted with WebCrypto, so
   *                                this trades a blocked request for no
   *                                encryption at all.
   *   allowMixedContent: true      globally re-permits mixed content for every
   *                                request the app will ever make. Capacitor
   *                                documents it as not for production, and it
   *                                is far more than one LAN call needs.
   *
   * CapacitorHttp makes the request from native code, where the webview's
   * mixed-content rule does not apply, and nothing else in the app changes:
   * the question sync keeps using ordinary fetch over HTTPS.
   */
  var Http = global.Capacitor.Plugins && global.Capacitor.Plugins.CapacitorHttp;

  function transport(url, envelope) {
    if (!Http) {
      // A build without the plugin: try anyway rather than fail silently, and
      // let the mixed-content error surface as itself.
      return fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(envelope)
      }).then(function (r) {
        if (!r.ok) throw new Error('the other device refused the sync (' + r.status + ')');
        return r.json();
      });
    }

    return Http.request({
      url: url,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Passed as an object, not a string: CapacitorHttp serialises JSON
      // itself, and handing it a pre-encoded string gets it sent as a quoted
      // JSON string that the other end cannot parse as an envelope.
      data: envelope
    }).then(function (r) {
      if (r.status < 200 || r.status >= 300) {
        throw new Error('the other device refused the sync (' + r.status + ')');
      }
      // Native returns parsed JSON when the content type says so, and a string
      // otherwise.
      return typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
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

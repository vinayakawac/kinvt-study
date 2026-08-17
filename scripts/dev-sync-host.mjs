// A standalone sync peer, for testing the phone against something real.
//
// The sync protocol had 22 unit tests and a real-socket test, and had still
// never run device to device — the emulator is NAT'd off the LAN, so there was
// nothing on it to sync with. That gap is what hid the cleartext bug: Android
// blocks plain HTTP by default, so sync could not have worked on any real
// device, and no test could have noticed because no test crossed a device
// boundary.
//
// This stands up the listener the desktop shells run, as its own process, with
// progress in it. The Android emulator reaches the host machine at 10.0.2.2,
// so the phone can now sync with something that is genuinely not itself.
//
// It is a test fixture, not a shipped component: it prints the pairing key so
// the phone can be seeded without a camera, which is exactly the thing the
// real pairing flow exists to avoid.
//
// usage: node scripts/dev-sync-host.mjs [port]
//   then, on the phone, either scan the printed URL as a QR or seed the peer
//   by hand, using host 10.0.2.2 from an emulator.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModules, makeLocalStorage } from './test/harness.mjs';

const PORT = parseInt(process.argv[2], 10) || 8787;
const SYNC = ['merge.js', 'storage.js', 'progress.js', 'sync-crypto.js', 'sync-pairing.js', 'sync-session.js'];

const host = loadModules(SYNC, { localStorage: makeLocalStorage() });

// Some answers to sync, so a successful exchange is visible rather than a
// pair of empty payloads agreeing with each other.
host.KinvtProgress.recordAnswer({ id: 'desk-1', category: 'upsc' }, true);
host.KinvtProgress.recordAnswer({ id: 'desk-2', category: 'upsc' }, false);
host.KinvtProgress.recordAnswer({ id: 'desk-3', category: 'current-affairs' }, true);

const key = await host.KinvtSyncCrypto.newKey();
const deviceId = host.KinvtProgress.thisDevice();

// 'pending' is what the desktop stores while a code is on screen: whichever
// device presents itself during the window is accepted and recorded on first
// contact.
host.KinvtPairing.savePeer('pending', key, 'Pending');

// Byte for byte the listener in desktop/main.js and the Rust one: same path,
// same 404 for everything else, same size cap.
const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/v1/sync') { res.writeHead(404).end(); return; }
  let body = '';
  req.on('data', (c) => {
    body += c;
    if (body.length > 4 * 1024 * 1024) { res.writeHead(413).end(); req.destroy(); }
  });
  req.on('end', async () => {
    try {
      const reply = await host.KinvtSync.handleRequest(JSON.parse(body), (d) => {
        const p = host.KinvtPairing.getPeer(d) || host.KinvtPairing.getPeer('pending');
        return p && p.key;
      });
      console.log(`  ← ${reply.status} to ${req.socket.remoteAddress}`);
      res.writeHead(reply.status, { 'content-type': 'application/json' });
      res.end(reply.envelope ? JSON.stringify(reply.envelope) : '');
    } catch (e) {
      console.log('  ← 400 ' + e.message);
      res.writeHead(400).end();
    }
  });
});

// 0.0.0.0, not 127.0.0.1: the emulator arrives from outside the loopback
// interface, and so does a real phone on the same Wi-Fi.
server.listen(PORT, '0.0.0.0', () => {
  const url = host.KinvtPairing.buildUrl({
    host: '10.0.2.2',
    port: PORT,
    key,
    deviceId,
    expiresAt: Date.now() + 60 * 60 * 1000     // an hour, not two minutes
  });
  console.log(`sync host listening on 0.0.0.0:${PORT}`);
  console.log(`device id  ${deviceId}`);
  console.log(`answers    ${host.KinvtProgress.getStats() ? 3 : 0} recorded`);
  console.log(`\npairing url (emulator):\n${url}\n`);
  console.log('waiting for a sync…');
});

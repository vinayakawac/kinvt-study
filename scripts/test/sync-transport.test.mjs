// The sync protocol over a real socket.
//
// sync.test.mjs proves the protocol with the transport stubbed out. This one
// stands up an actual HTTP listener shaped exactly like the shells' — same
// path, same 404 for everything else, same size cap — and syncs two devices
// through it. Between them, nothing about the exchange is unexercised.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { loadModules, makeLocalStorage } from './harness.mjs';

const SYNC = ['merge.js', 'storage.js', 'progress.js', 'sync-crypto.js', 'sync-pairing.js', 'sync-session.js'];
const device = () => loadModules(SYNC, { localStorage: makeLocalStorage() });
const q = (id, category) => ({ id, category });

// Mirrors the listener in desktop/main.js and the Rust one: owns the socket,
// hands the envelope to the device, writes the answer back.
function listen(host) {
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
          const p = host.KinvtPairing.getPeer(d);
          return p && p.key;
        });
        res.writeHead(reply.status, { 'content-type': 'application/json' });
        res.end(reply.envelope ? JSON.stringify(reply.envelope) : '');
      } catch (e) {
        res.writeHead(400).end();
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const transport = async (url, envelope) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(envelope)
  });
  if (!res.ok) throw new Error('http ' + res.status);
  return res.json();
};

test('two devices sync over a real socket and converge', async () => {
  const desktop = device();
  const phone = device();
  desktop.KinvtProgress.recordAnswer(q('up-1', 'upsc'), true);
  desktop.KinvtProgress.recordAnswer(q('up-2', 'upsc'), false);
  phone.KinvtProgress.recordAnswer(q('ss-1', 'ssc'), true);
  phone.KinvtProgress.recordAnswer(q('ss-2', 'ssc'), false);

  const key = await desktop.KinvtSyncCrypto.newKey();
  const desktopId = desktop.KinvtProgress.thisDevice();
  const phoneId = phone.KinvtProgress.thisDevice();

  // Both sides know the pairing, as they would after a QR scan.
  desktop.KinvtPairing.savePeer(phoneId, key, 'Phone');
  phone.KinvtPairing.savePeer(desktopId, key, 'Desktop');

  const { server, port } = await listen(desktop);
  try {
    const out = await phone.KinvtSync.syncWith(
      { deviceId: desktopId, host: '127.0.0.1', port, key }, transport
    );
    assert.deepEqual(out, { ok: true });

    const dt = desktop.KinvtMerge.totals(desktop.KinvtProgress.getStats());
    const pt = phone.KinvtMerge.totals(phone.KinvtProgress.getStats());
    assert.deepEqual(dt, { answered: 4, correct: 2 });
    assert.deepEqual(pt, dt, 'both devices agree after a real round trip');

    // Both missed questions are now known to both devices.
    assert.equal(desktop.KinvtProgress.reviewCount(), 2);
    assert.equal(phone.KinvtProgress.reviewCount(), 2);
  } finally {
    server.close();
  }
});

test('syncing twice over the socket does not double anything', async () => {
  const desktop = device();
  const phone = device();
  desktop.KinvtProgress.recordAnswer(q('up-1', 'upsc'), true);
  phone.KinvtProgress.recordAnswer(q('ss-1', 'ssc'), true);

  const key = await desktop.KinvtSyncCrypto.newKey();
  const desktopId = desktop.KinvtProgress.thisDevice();
  desktop.KinvtPairing.savePeer(phone.KinvtProgress.thisDevice(), key, 'Phone');
  phone.KinvtPairing.savePeer(desktopId, key, 'Desktop');

  const { server, port } = await listen(desktop);
  try {
    const peer = { deviceId: desktopId, host: '127.0.0.1', port, key };
    await phone.KinvtSync.syncWith(peer, transport);
    const after1 = phone.KinvtMerge.totals(phone.KinvtProgress.getStats());
    await phone.KinvtSync.syncWith(peer, transport);
    await phone.KinvtSync.syncWith(peer, transport);
    assert.deepEqual(phone.KinvtMerge.totals(phone.KinvtProgress.getStats()), after1);
    assert.deepEqual(after1, { answered: 2, correct: 2 });
  } finally {
    server.close();
  }
});

test('the listener serves nothing but /v1/sync', async () => {
  const desktop = device();
  const { server, port } = await listen(desktop);
  try {
    for (const path of ['/', '/index.html', '/../desktop/ui/settings.js', '/v1/sync/../..']) {
      const res = await fetch(`http://127.0.0.1:${port}${path}`);
      assert.equal(res.status, 404, `${path} must not be served`);
    }
    // Right path, wrong method.
    assert.equal((await fetch(`http://127.0.0.1:${port}/v1/sync`)).status, 404);
  } finally {
    server.close();
  }
});

test('an unpaired device gets 401 from the socket', async () => {
  const desktop = device();
  const stranger = device();
  const { server, port } = await listen(desktop);
  try {
    const key = await stranger.KinvtSyncCrypto.newKey();
    const out = await stranger.KinvtSync.syncWith(
      { deviceId: 'nobody', host: '127.0.0.1', port, key }, transport
    );
    assert.equal(out.ok, false);
    assert.match(out.error, /401/);
  } finally {
    server.close();
  }
});

test('garbage posted to the endpoint is a 400, and the server survives it', async () => {
  const desktop = device();
  const { server, port } = await listen(desktop);
  try {
    const bad = await fetch(`http://127.0.0.1:${port}/v1/sync`, { method: 'POST', body: 'not json' });
    assert.equal(bad.status, 400);
    // Still answering afterwards — a malformed request must not kill it.
    assert.equal((await fetch(`http://127.0.0.1:${port}/nope`)).status, 404);
  } finally {
    server.close();
  }
});

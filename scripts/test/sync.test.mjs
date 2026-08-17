import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules, makeLocalStorage } from './harness.mjs';

const SYNC = ['merge.js', 'storage.js', 'progress.js', 'sync-crypto.js', 'sync-pairing.js', 'sync-session.js'];

// Two independent replicas in one process: separate storage, separate globals.
const device = (seed) => loadModules(SYNC, { localStorage: makeLocalStorage(seed) });
const q = (id, category) => ({ id, category });

/* ---------- crypto ---------- */

test('a sealed envelope round-trips with the right key', async () => {
  const { KinvtSyncCrypto: c } = device();
  const k = await c.newKey();
  const env = await c.seal(k, { hello: 'world', n: 42 });
  assert.equal(env.v, c.WIRE_VERSION);
  assert.deepEqual(await c.open(k, env), { hello: 'world', n: 42 });
});

test('a wrong key cannot open it', async () => {
  const { KinvtSyncCrypto: c } = device();
  const good = await c.newKey();
  const bad = await c.newKey();
  const env = await c.seal(good, { secret: 1 });
  await assert.rejects(() => c.open(bad, env));
});

test('tampering with the ciphertext is detected', async () => {
  const { KinvtSyncCrypto: c } = device();
  const k = await c.newKey();
  const env = await c.seal(k, { secret: 1 });
  // GCM authenticates as well as encrypts: a flipped bit fails the tag rather
  // than decrypting to something plausible.
  const bytes = c.fromB64u(env.ct);
  bytes[0] ^= 0xff;
  await assert.rejects(() => c.open(k, { ...env, ct: c.toB64u(bytes) }));
});

test('each sealing uses a fresh nonce', async () => {
  const { KinvtSyncCrypto: c } = device();
  const k = await c.newKey();
  const a = await c.seal(k, { x: 1 });
  const b = await c.seal(k, { x: 1 });
  assert.notEqual(a.nonce, b.nonce, 'reusing a nonce with GCM is catastrophic');
  assert.notEqual(a.ct, b.ct);
});

test('a stale envelope is refused even though it is authentic', async () => {
  const { KinvtSyncCrypto: c } = device();
  const k = await c.newKey();
  const stale = await c.seal(k, { x: 1 }, Date.now() - c.MAX_SKEW_MS - 60000);
  await assert.rejects(() => c.open(k, stale), /stale/i);
});

test('a wrong wire version is refused before any decryption', async () => {
  const { KinvtSyncCrypto: c } = device();
  const k = await c.newKey();
  const env = await c.seal(k, { x: 1 });
  await assert.rejects(() => c.open(k, { ...env, v: 99 }), /version/i);
});

test('base64url is URL-safe and round-trips', () => {
  const { KinvtSyncCrypto: c } = device();
  const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255]);
  const s = c.toB64u(bytes);
  assert.ok(!/[+/=]/.test(s), 'must survive being put in a QR URL');
  assert.deepEqual(Array.from(c.fromB64u(s)), Array.from(bytes));
});

/* ---------- pairing ---------- */

test('a pairing url round-trips', () => {
  const { KinvtPairing: P } = device();
  const key = new Uint8Array(32).fill(7);
  const url = P.buildUrl({ host: '192.168.1.9', port: 51234, key, deviceId: 'dsk-abc123', expiresAt: Date.now() + 60000 });
  assert.ok(url.startsWith('kinvt1://'));
  const got = P.parseUrl(url);
  assert.equal(got.host, '192.168.1.9');
  assert.equal(got.port, 51234);
  assert.equal(got.deviceId, 'dsk-abc123');
  assert.deepEqual(Array.from(got.key), Array.from(key));
});

test('an expired pairing url is refused', () => {
  const { KinvtPairing: P } = device();
  // A code photographed over your shoulder must stop working quickly.
  const url = P.buildUrl({ host: '10.0.0.2', port: 5000, key: new Uint8Array(32), deviceId: 'dsk-1', expiresAt: Date.now() - 1 });
  assert.throws(() => P.parseUrl(url), /expired/i);
});

test('a foreign scheme or malformed code is refused, not half-parsed', () => {
  const { KinvtPairing: P } = device();
  assert.throws(() => P.parseUrl('https://evil.example/?k=aaa'), /scheme/i);
  assert.throws(() => P.parseUrl('nonsense'), /scheme/i);
  assert.throws(() => P.parseUrl('kinvt1://1.2.3.4:80/'), /key/i);
});

test('a key of the wrong length is refused', () => {
  const { KinvtPairing: P, KinvtSyncCrypto: c } = device();
  const short = c.toB64u(new Uint8Array(8));
  assert.throws(
    () => P.parseUrl(`kinvt1://1.2.3.4:5000/?k=${short}&d=dsk-1&e=${Date.now() + 60000}`),
    /length/i
  );
});

test('peers persist, list, and can be forgotten', () => {
  const { KinvtPairing: P } = device();
  const key = new Uint8Array(32).fill(3);
  P.savePeer('and-77aabb', key, 'Pixel');
  assert.deepEqual(Array.from(P.getPeer('and-77aabb').key), Array.from(key));
  assert.deepEqual(P.listPeers().map(p => p.deviceId), ['and-77aabb']);

  P.touchPeer('and-77aabb', 1755300000000);
  assert.equal(P.getPeer('and-77aabb').lastSyncAt, 1755300000000);

  P.forgetPeer('and-77aabb');
  assert.equal(P.getPeer('and-77aabb'), null, 'forgetting deletes the shared key');
  assert.equal(P.getPeer('nobody'), null, 'an unknown peer is null, not an exception');
});

/* ---------- the exchange ---------- */

async function exchange(phone, desktop, key) {
  const req = await phone.KinvtSyncCrypto.seal(key, {
    deviceId: phone.KinvtProgress.thisDevice(),
    payload: phone.KinvtSync.localPayload()
  });
  req.d = phone.KinvtProgress.thisDevice();
  const res = await desktop.KinvtSync.handleRequest(req, () => key);
  if (res.status !== 200) return res.status;
  const back = await phone.KinvtSyncCrypto.open(key, res.envelope);
  phone.KinvtSync.applyRemote(back.payload);
  return 200;
}

test('two devices converge after one exchange', async () => {
  const desktop = device();
  const phone = device();
  desktop.KinvtProgress.recordAnswer(q('up-1', 'upsc'), true);
  desktop.KinvtProgress.recordAnswer(q('up-2', 'upsc'), false);
  phone.KinvtProgress.recordAnswer(q('ss-1', 'ssc'), true);

  const key = await desktop.KinvtSyncCrypto.newKey();
  assert.equal(await exchange(phone, desktop, key), 200);

  const dt = desktop.KinvtMerge.totals(desktop.KinvtProgress.getStats());
  const pt = phone.KinvtMerge.totals(phone.KinvtProgress.getStats());
  assert.deepEqual(dt, { answered: 3, correct: 2 });
  assert.deepEqual(pt, dt, 'both devices agree');
});

test('syncing repeatedly changes nothing after the first time', async () => {
  const desktop = device();
  const phone = device();
  desktop.KinvtProgress.recordAnswer(q('up-1', 'upsc'), true);
  phone.KinvtProgress.recordAnswer(q('ss-1', 'ssc'), false);

  const key = await desktop.KinvtSyncCrypto.newKey();
  await exchange(phone, desktop, key);
  const after1 = desktop.KinvtMerge.totals(desktop.KinvtProgress.getStats());

  await exchange(phone, desktop, key);
  await exchange(phone, desktop, key);

  assert.deepEqual(desktop.KinvtMerge.totals(desktop.KinvtProgress.getStats()), after1);
  assert.deepEqual(phone.KinvtMerge.totals(phone.KinvtProgress.getStats()), after1);
});

test('a review miss on the phone reaches the desktop', async () => {
  const desktop = device();
  const phone = device();
  phone.KinvtProgress.recordAnswer(q('up-9', 'upsc'), false);
  const key = await desktop.KinvtSyncCrypto.newKey();
  await exchange(phone, desktop, key);
  assert.equal(desktop.KinvtProgress.reviewCount(), 1, 'the desktop now knows to re-ask it');
});

test('a retirement on one device is not undone by the other', async () => {
  const desktop = device();
  const phone = device();
  // Phone misses it, syncs, then masters it. The desktop still holds the old
  // un-retired entry — a delete-based design would resurrect it here.
  phone.KinvtProgress.recordAnswer(q('up-7', 'upsc'), false);
  const key = await desktop.KinvtSyncCrypto.newKey();
  await exchange(phone, desktop, key);
  assert.equal(desktop.KinvtProgress.reviewCount(), 1);

  phone.KinvtProgress.recordAnswer(q('up-7', 'upsc'), true);
  phone.KinvtProgress.recordAnswer(q('up-7', 'upsc'), true);
  await exchange(phone, desktop, key);
  assert.equal(desktop.KinvtProgress.reviewCount(), 0, 'the tombstone travelled');
  assert.equal(phone.KinvtProgress.reviewCount(), 0);
});

test('a request sealed with the wrong key is rejected with 401 and no body', async () => {
  const desktop = device();
  const attacker = device();
  const real = await desktop.KinvtSyncCrypto.newKey();
  const wrong = await desktop.KinvtSyncCrypto.newKey();

  const req = await attacker.KinvtSyncCrypto.seal(wrong, {
    deviceId: 'and-evil', payload: attacker.KinvtSync.localPayload()
  });
  req.d = 'and-evil';
  const res = await desktop.KinvtSync.handleRequest(req, () => real);
  assert.equal(res.status, 401);
  assert.equal(res.envelope, undefined, 'nothing is returned to an unauthenticated caller');
});

test('an unknown device is rejected without attempting decryption', async () => {
  const desktop = device();
  const phone = device();
  const key = await desktop.KinvtSyncCrypto.newKey();
  const req = await phone.KinvtSyncCrypto.seal(key, { deviceId: 'and-x', payload: {} });
  req.d = 'and-x';
  assert.equal((await desktop.KinvtSync.handleRequest(req, () => null)).status, 401);
});

test('a malformed envelope is a 400, not a crash', async () => {
  const desktop = device();
  const key = await desktop.KinvtSyncCrypto.newKey();
  assert.equal((await desktop.KinvtSync.handleRequest(null, () => key)).status, 400);
  assert.equal((await desktop.KinvtSync.handleRequest({ v: 1 }, () => key)).status, 400);
  assert.equal((await desktop.KinvtSync.handleRequest({ v: 99, nonce: 'a', ct: 'b' }, () => key)).status, 400);
});

test('a payload version the device does not understand is a 422', async () => {
  const desktop = device();
  const phone = device();
  const key = await desktop.KinvtSyncCrypto.newKey();
  const req = await phone.KinvtSyncCrypto.seal(key, { deviceId: 'and-1', payload: { version: 99 } });
  req.d = 'and-1';
  assert.equal((await desktop.KinvtSync.handleRequest(req, () => key)).status, 422);
});

test('syncWith drives the client side through a transport', async () => {
  const desktop = device();
  const phone = device();
  desktop.KinvtProgress.recordAnswer(q('up-1', 'upsc'), true);

  const key = await desktop.KinvtSyncCrypto.newKey();
  const desktopId = desktop.KinvtProgress.thisDevice();
  phone.KinvtPairing.savePeer(desktopId, key, 'Desktop');

  const transport = async (url, envelope) => {
    assert.match(url, /^http:\/\/127\.0\.0\.1:1\/v1\/sync$/);
    const res = await desktop.KinvtSync.handleRequest(envelope, () => key);
    if (res.status !== 200) throw new Error('http ' + res.status);
    return res.envelope;
  };

  assert.deepEqual(
    await phone.KinvtSync.syncWith({ deviceId: desktopId, host: '127.0.0.1', port: 1, key }, transport),
    { ok: true }
  );
  assert.deepEqual(phone.KinvtMerge.totals(phone.KinvtProgress.getStats()), { answered: 1, correct: 1 });
  assert.ok(phone.KinvtPairing.getPeer(desktopId).lastSyncAt > 0, 'a successful sync is recorded');
});

test('a transport failure reports cleanly and changes nothing', async () => {
  const phone = device();
  phone.KinvtProgress.recordAnswer(q('ss-1', 'ssc'), true);
  const before = phone.KinvtMerge.totals(phone.KinvtProgress.getStats());

  const out = await phone.KinvtSync.syncWith(
    { deviceId: 'dsk-gone', host: '10.0.0.9', port: 1, key: await phone.KinvtSyncCrypto.newKey() },
    () => Promise.reject(new Error('ECONNREFUSED'))
  );
  assert.equal(out.ok, false);
  assert.match(out.error, /ECONNREFUSED/);
  assert.deepEqual(phone.KinvtMerge.totals(phone.KinvtProgress.getStats()), before);
});

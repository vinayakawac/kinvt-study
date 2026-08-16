# Sub-project B — The Android Shell

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Android app that runs the existing quiz UI and question banks, stores progress durably, and reminds you to study on a schedule — installable as an APK from GitHub Releases.

**Architecture:** Capacitor wraps `desktop/ui/` unchanged. A generated `mobile/www/` is a copy of that folder plus a small shim that supplies the platform pieces the desktop shell provides via Tauri. Storage moves behind an async-capable `KinvtStorage` so the webview's fragile localStorage is not the system of record.

**Tech Stack:** Capacitor 6, Android SDK, Gradle, `@capacitor/preferences`, `@capacitor/local-notifications`, `node --test`.

## Global Constraints

- **PREREQUISITE:** Sub-project A complete (`docs/superpowers/plans/2026-08-16-A-shared-core-crdt.md`). Progress must already be schema 2 before a second device exists.
- **`desktop/ui/` is the single source of truth.** `mobile/www/` is generated and must never be edited by hand — same rule as the root `data/` feed.
- **No build step for the UI.** The shim is another IIFE `<script>`, not a bundler entry point.
- **iOS is out of scope** but nothing may deliberately preclude it: no Android-only API is called outside `mobile/src/shim/`.
- **Secrets never enter the repo.** The signing keystore and its passwords live only in GitHub Actions secrets and on your machine.
- Package id: `com.kinvtstudy.quiz` — the same identifier the desktop bundle already uses.
- App display name: `Kinvt-study`.
- Minimum Android API 24 (7.0), target the latest stable API.
- Tests run from the repo root: `node --test scripts/test/`.

---

### Task 1: Generate `mobile/www/` from the shared UI

Before any Capacitor project exists, establish the copy step — so the mobile app can never drift from the desktop UI.

**Files:**
- Create: `scripts/build-mobile-www.mjs`
- Modify: `.github/workflows/ci.yml`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `desktop/ui/`, `desktop/ui/library.json`.
- Produces: `node scripts/build-mobile-www.mjs [--check]` — copies the UI into `mobile/www/`; `--check` verifies it is current and exits non-zero if not.

- [ ] **Step 1: Write the generator**

Create `scripts/build-mobile-www.mjs`:

```js
// Generates mobile/www from desktop/ui.
//
// The app exists in three places now — the desktop bundle, the root data/
// sync feed, and the Android package — and only one of them is written by
// hand. Copying rather than symlinking is deliberate: Gradle packages what is
// on disk, and a symlink would either break the build or silently ship
// nothing.
//
// usage: node scripts/build-mobile-www.mjs [--check]
//        --check verifies mobile/www matches desktop/ui without writing.
import fs from 'node:fs';
import path from 'node:path';

const check = process.argv.includes('--check');
const UI = path.join('desktop', 'ui');
const WWW = path.join('mobile', 'www');

// The preview harness and the desktop-only Tauri shim have no place in an APK.
const SKIP = /^_preview/;

function walk(dir, base = '') {
  const out = [];
  for (const name of fs.readdirSync(path.join(dir, base))) {
    const rel = path.join(base, name);
    if (SKIP.test(name)) continue;
    if (fs.statSync(path.join(dir, rel)).isDirectory()) out.push(...walk(dir, rel));
    else out.push(rel);
  }
  return out;
}

const files = walk(UI);
const stale = [];

for (const rel of files) {
  const from = path.join(UI, rel);
  const to = path.join(WWW, rel);
  const src = fs.readFileSync(from);
  const cur = fs.existsSync(to) ? fs.readFileSync(to) : null;
  if (cur && cur.equals(src)) continue;
  stale.push(rel);
  if (!check) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, src);
  }
}

// A file deleted from desktop/ui must not linger in the APK.
const orphans = fs.existsSync(WWW)
  ? walk(WWW).filter(rel => !files.includes(rel) && !rel.startsWith('shim'))
  : [];
for (const rel of orphans) {
  stale.push(rel + ' (removed)');
  if (!check) fs.unlinkSync(path.join(WWW, rel));
}

if (check) {
  if (stale.length) {
    console.error(`\n✗ mobile/www is stale — ${stale.length} file(s) differ from desktop/ui:`);
    stale.forEach(f => console.error('  - ' + f));
    console.error('\nRun: node scripts/build-mobile-www.mjs');
    process.exit(1);
  }
  console.log(`✓ mobile/www matches desktop/ui (${files.length} files)`);
} else {
  console.log(stale.length
    ? `✓ updated ${stale.length} file(s) in mobile/www`
    : `✓ mobile/www already current (${files.length} files)`);
}
```

- [ ] **Step 2: Run it and prove the drift check works**

```bash
node scripts/build-mobile-www.mjs
node scripts/build-mobile-www.mjs --check
```

Expected: first reports files copied, second reports a match.

Then prove the check bites:

```bash
printf '\n/* drift */\n' >> mobile/www/settings.css
node scripts/build-mobile-www.mjs --check
```

Expected: exits non-zero, names `settings.css`. Restore with `node scripts/build-mobile-www.mjs`.

- [ ] **Step 3: Ignore the generated tree**

Add to `.gitignore`:

```gitignore
# Generated from desktop/ui by scripts/build-mobile-www.mjs
mobile/www/
# Android build output
mobile/android/app/build/
mobile/android/build/
mobile/android/.gradle/
mobile/node_modules/
# Signing material must never be committed
*.keystore
*.jks
```

- [ ] **Step 4: Gate it in CI**

In `.github/workflows/ci.yml`, in the `content` job after the sync-feed check:

```yaml
      - name: Mobile UI copy is current
        run: |
          node scripts/build-mobile-www.mjs
          node scripts/build-mobile-www.mjs --check
```

The copy runs first because `mobile/www/` is gitignored and therefore absent on a fresh checkout; the check then proves the generator is deterministic.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-mobile-www.mjs .gitignore .github/workflows/ci.yml
git commit -m "Generate the mobile UI from desktop/ui, and fail CI on drift"
```

---

### Task 2: Scaffold the Capacitor project

**Files:**
- Create: `mobile/package.json`
- Create: `mobile/capacitor.config.json`
- Create: `mobile/android/` (generated by Capacitor, committed)
- Create: `mobile/README.md`

**Interfaces:**
- Consumes: `mobile/www/` from Task 1.
- Produces: a buildable Android project at `mobile/android/`.

- [ ] **Step 1: Create the package manifest**

Create `mobile/package.json`:

```json
{
  "name": "kinvt-study-mobile",
  "version": "1.0.0",
  "description": "Kinvt-study for Android",
  "license": "MIT",
  "private": true,
  "scripts": {
    "www": "node ../scripts/build-mobile-www.mjs",
    "sync": "npm run www && cap sync android",
    "open": "cap open android",
    "apk": "npm run sync && cd android && gradlew.bat assembleRelease"
  },
  "dependencies": {
    "@capacitor/android": "^6.2.0",
    "@capacitor/core": "^6.2.0",
    "@capacitor/local-notifications": "^6.1.0",
    "@capacitor/preferences": "^6.0.0",
    "@capacitor/app": "^6.0.0"
  },
  "devDependencies": {
    "@capacitor/cli": "^6.2.0"
  }
}
```

- [ ] **Step 2: Create the Capacitor config**

Create `mobile/capacitor.config.json`:

```json
{
  "appId": "com.kinvtstudy.quiz",
  "appName": "Kinvt-study",
  "webDir": "www",
  "server": {
    "androidScheme": "https"
  },
  "android": {
    "backgroundColor": "#1c1b19"
  },
  "plugins": {
    "LocalNotifications": {
      "smallIcon": "ic_stat_kinvt",
      "iconColor": "#f5f1dd"
    }
  }
}
```

`androidScheme: https` matters: it makes the webview origin `https://localhost`, which is a secure context. Without it `crypto.subtle` — which sub-project C's sync depends on entirely — is unavailable.

`backgroundColor` matches `--bg` in `settings.css` so the app does not flash white while the webview loads.

- [ ] **Step 3: Install and generate the Android project**

```bash
cd mobile
npm install
node ../scripts/build-mobile-www.mjs
npx cap add android
```

Expected: `mobile/android/` is created and `npx cap sync android` reports the plugins found.

- [ ] **Step 4: Commit the generated project**

`mobile/android/` is committed (unlike `www/`) because it holds hand-edited files from later tasks — the manifest, the notification icon, and signing config.

```bash
git add mobile/package.json mobile/package-lock.json mobile/capacitor.config.json mobile/android
git commit -m "Scaffold the Capacitor Android project"
```

- [ ] **Step 5: Build a debug APK to prove the toolchain works**

```bash
cd mobile/android && gradlew.bat assembleDebug
```

Expected: `mobile/android/app/build/outputs/apk/debug/app-debug.apk` exists. Install it on a device or emulator and confirm the settings page renders with the topic list.

It will not yet schedule anything, and storage is still the webview's — those are the next two tasks.

- [ ] **Step 6: Write the build notes**

Create `mobile/README.md`:

```markdown
# Kinvt-study for Android

The UI and question banks are **not** in this folder. They live in
`desktop/ui/` and are copied here by `scripts/build-mobile-www.mjs`.
Never edit `mobile/www/` — it is generated, and your changes will be
overwritten on the next build.

## Build

Requires Android Studio (or the SDK plus Java 17).

```bash
cd mobile
npm install
npm run sync          # regenerates www/ and syncs Capacitor
npm run open          # opens Android Studio
```

A release APK without Android Studio:

```bash
npm run apk           # -> android/app/build/outputs/apk/release/
```

## Signing

Release builds need a keystore, which is not in this repository. Generate one
once:

```bash
keytool -genkey -v -keystore kinvt-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias kinvt
```

Keep it safe. **Losing it means you can never update an app already installed
from a Play Store listing** — Android rejects an update signed by a different
key. Put the file and its passwords into GitHub Actions secrets for CI builds;
never commit them.
```

```bash
git add mobile/README.md
git commit -m "Document the Android build and what losing the keystore costs"
```

---

### Task 3: Durable storage behind `KinvtStorage`

**Files:**
- Create: `mobile/src/shim/storage-native.js`
- Modify: `desktop/ui/storage.js`
- Create: `scripts/test/storage-async.test.mjs`
- Modify: `scripts/build-mobile-www.mjs`

**Interfaces:**
- Consumes: `KinvtStorage` from sub-project A.
- Produces:
  - `KinvtStorage.setBackend(backend)` where `backend` is `{getItem(k), setItem(k,v), removeItem(k)}` operating on an in-memory cache synchronously and persisting asynchronously.
  - `KinvtStorage.ready() -> Promise<void>` — resolves once a native backend has loaded existing data into the cache.

- [ ] **Step 1: Write the failing test**

Create `scripts/test/storage-async.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules, makeLocalStorage } from './harness.mjs';

test('with no backend set, storage uses localStorage as before', () => {
  const localStorage = makeLocalStorage();
  const { KinvtStorage: S } = loadModules(['storage.js'], { localStorage });
  S.write('kinvt.stats', { answered: 1 });
  assert.equal(localStorage.getItem('kinvt.stats'), '{"answered":1}');
});

test('a backend receives every write', async () => {
  const { KinvtStorage: S } = loadModules(['storage.js']);
  const written = [];
  S.setBackend({
    getItem: () => null,
    setItem: (k, v) => { written.push([k, v]); return Promise.resolve(); },
    removeItem: () => Promise.resolve()
  });
  S.write('kinvt.stats', { answered: 2 });
  assert.deepEqual(written, [['kinvt.stats', '{"answered":2}']]);
});

test('reads stay synchronous once the cache is warm', async () => {
  const { KinvtStorage: S } = loadModules(['storage.js']);
  S.setBackend({
    // The whole point: progress.js and selection.js call read() synchronously
    // in hot paths. The backend hydrates a cache up front so they never have
    // to become async.
    getItem: (k) => Promise.resolve(k === 'kinvt.stats' ? '{"answered":7}' : null),
    setItem: () => Promise.resolve(),
    removeItem: () => Promise.resolve()
  });
  await S.ready();
  assert.deepEqual(S.read('kinvt.stats', { answered: 0 }), { answered: 7 });
});

test('ready() resolves immediately when there is no backend', async () => {
  const { KinvtStorage: S } = loadModules(['storage.js']);
  await S.ready();   // must not hang
  assert.ok(true);
});

test('a failing backend does not lose the in-memory value', async () => {
  const { KinvtStorage: S } = loadModules(['storage.js']);
  S.setBackend({
    getItem: () => Promise.resolve(null),
    setItem: () => Promise.reject(new Error('disk full')),
    removeItem: () => Promise.resolve()
  });
  await S.ready();
  assert.equal(S.write('kinvt.stats', { answered: 3 }), true);
  assert.deepEqual(S.read('kinvt.stats', {}), { answered: 3 }, 'still readable this session');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/test/storage-async.test.mjs`
Expected: FAIL — `S.setBackend is not a function`.

- [ ] **Step 3: Add the backend seam to `storage.js`**

In `desktop/ui/storage.js`, add above the exports:

```js
  /* ---------- pluggable backend ----------
   * The desktop keeps localStorage. Android must not: the system can clear
   * webview data under storage pressure, and months of review history exist
   * nowhere else — there is no server to restore them from.
   *
   * progress.js and selection.js read on hot paths and are synchronous, and
   * making them async would ripple through every caller including the quiz
   * card. So a native backend hydrates an in-memory cache once at startup;
   * reads stay synchronous against the cache, and writes fan out to the
   * backend without being awaited.
   */
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
    return global.localStorage.getItem(key);
  }

  function rawSet(key, value) {
    if (backend) {
      cache[key] = value;
      // Not awaited: a slow or failing write must not stall the quiz. The
      // value is already in the cache, so this session is unaffected either
      // way, and the next write retries implicitly.
      Promise.resolve(backend.setItem(key, value)).catch(function () { /* noop */ });
      return;
    }
    global.localStorage.setItem(key, value);
  }
```

Then change `read`, `write`, `readNumber`, `writeNumber` and `deviceId` to call `rawGet`/`rawSet` instead of touching `global.localStorage` directly, and add `setBackend: setBackend, ready: ready,` to the exports.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/test/storage-async.test.mjs`
Expected: PASS — 5 tests.

Then run the whole suite: `node --test scripts/test/` — the desktop path is unchanged and everything must still pass.

- [ ] **Step 5: Write the native backend**

Create `mobile/src/shim/storage-native.js`:

```js
/*
 * Kinvt-study — Android storage backend.
 *
 * Capacitor Preferences writes to SharedPreferences, which survives what the
 * webview's localStorage does not: storage pressure, cache clearing, and the
 * user tapping "Clear cache" in app settings. Progress exists nowhere else,
 * so this is not an optimisation.
 */
(function (global) {
  'use strict';
  if (!global.Capacitor || !global.Capacitor.Plugins || !global.Capacitor.Plugins.Preferences) return;

  var P = global.Capacitor.Plugins.Preferences;

  global.KinvtStorage.setBackend({
    getItem: function (key) {
      return P.get({ key: key }).then(function (r) { return r.value; });
    },
    setItem: function (key, value) {
      return P.set({ key: key, value: value });
    },
    removeItem: function (key) {
      return P.remove({ key: key });
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 6: Copy the shim into the build**

In `scripts/build-mobile-www.mjs`, after the main copy loop, add:

```js
// The shim supplies what Tauri provides on the desktop. It lives outside
// desktop/ui because it is meaningless there, and is copied in alongside.
const SHIM_SRC = path.join('mobile', 'src', 'shim');
if (fs.existsSync(SHIM_SRC)) {
  for (const name of fs.readdirSync(SHIM_SRC)) {
    const to = path.join(WWW, 'shim', name);
    const src = fs.readFileSync(path.join(SHIM_SRC, name));
    if (fs.existsSync(to) && fs.readFileSync(to).equals(src)) continue;
    stale.push(path.join('shim', name));
    if (!check) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(to, src);
    }
  }
}
```

- [ ] **Step 7: Load the shim before the UI modules**

The shim must set the backend before `progress.js` reads anything. `settings.html` and `index.html` are shared with the desktop, where `shim/` does not exist — a missing script is a silent 404 and harmless, and the shim itself no-ops when `Capacitor` is absent.

Add to `desktop/ui/index.html` and `desktop/ui/settings.html`, immediately before `merge.js`:

```html
  <script src="shim/storage-native.js" onerror="/* desktop: no shim */"></script>
```

Update `scripts/check-ui-scripts.mjs` to ignore paths beginning `shim/`.

- [ ] **Step 8: Verify on a device**

Rebuild and install the debug APK. Answer a question, force-stop the app, clear the webview cache from Android app settings, then reopen.

Expected: the answered count survives. This is the behaviour localStorage would have lost.

- [ ] **Step 9: Commit**

```bash
git add desktop/ui/storage.js desktop/ui/index.html desktop/ui/settings.html mobile/src/shim/storage-native.js scripts/build-mobile-www.mjs scripts/check-ui-scripts.mjs scripts/test/storage-async.test.mjs
git commit -m "Store Android progress in SharedPreferences, not webview storage"
```

---

### Task 4: Study reminders

**Files:**
- Create: `mobile/src/shim/reminders.js`
- Create: `desktop/ui/quiet-hours.js`
- Create: `scripts/test/quiet-hours.test.mjs`
- Modify: `mobile/android/app/src/main/AndroidManifest.xml`
- Modify: `desktop/ui/settings.html`, `desktop/ui/settings.js`

**Interfaces:**
- Consumes: `KinvtQuiz.getSettings()`.
- Produces:
  - `KinvtQuietHours.isQuiet(nowMinutes: number, startMinutes: number, endMinutes: number) -> boolean` (pure)
  - `KinvtQuietHours.nextAllowed(nowMinutes, startMinutes, endMinutes) -> number`
  - Settings gain `quietStart` (default `1320`, 22:00) and `quietEnd` (default `420`, 07:00), both minutes since midnight.

- [ ] **Step 1: Write the failing test for quiet hours**

The wrapping case — a window that crosses midnight — is where this kind of code is usually wrong, so it is tested first.

Create `scripts/test/quiet-hours.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from './harness.mjs';

const Q = () => loadModules(['quiet-hours.js']).KinvtQuietHours;
const at = (h, m = 0) => h * 60 + m;

test('a window that crosses midnight covers both sides of it', () => {
  const q = Q();
  const start = at(22), end = at(7);
  assert.equal(q.isQuiet(at(23), start, end), true, '23:00 is inside');
  assert.equal(q.isQuiet(at(2), start, end), true, '02:00 is inside');
  assert.equal(q.isQuiet(at(6, 59), start, end), true);
  assert.equal(q.isQuiet(at(7), start, end), false, 'end is exclusive');
  assert.equal(q.isQuiet(at(12), start, end), false);
  assert.equal(q.isQuiet(at(21, 59), start, end), false);
  assert.equal(q.isQuiet(at(22), start, end), true, 'start is inclusive');
});

test('a window inside one day behaves normally', () => {
  const q = Q();
  const start = at(13), end = at(15);
  assert.equal(q.isQuiet(at(14), start, end), true);
  assert.equal(q.isQuiet(at(12), start, end), false);
  assert.equal(q.isQuiet(at(16), start, end), false);
});

test('an empty window silences nothing', () => {
  const q = Q();
  assert.equal(q.isQuiet(at(3), at(9), at(9)), false);
});

test('nextAllowed returns now when not quiet', () => {
  const q = Q();
  assert.equal(q.nextAllowed(at(12), at(22), at(7)), at(12));
});

test('nextAllowed returns the end of the window when quiet', () => {
  const q = Q();
  assert.equal(q.nextAllowed(at(23), at(22), at(7)), at(7) + 1440, 'tomorrow morning');
  assert.equal(q.nextAllowed(at(2), at(22), at(7)), at(7), 'later today');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test scripts/test/quiet-hours.test.mjs`
Expected: FAIL — `ENOENT` on `desktop/ui/quiet-hours.js`.

- [ ] **Step 3: Implement quiet hours**

Create `desktop/ui/quiet-hours.js`:

```js
/*
 * Kinvt-study — the hours when the app should stay silent.
 *
 * All times are minutes since midnight, which removes both timezone handling
 * and date arithmetic from the problem.
 *
 * The case worth care is a window that wraps midnight — 22:00 to 07:00 — which
 * is also the default and by far the most common. A naive `start <= now < end`
 * silences nothing at all for that window, because 22:00 is not less than
 * 07:00.
 */
(function (global) {
  'use strict';

  var DAY = 24 * 60;

  function isQuiet(now, start, end) {
    if (start === end) return false;               // an empty window
    if (start < end) return now >= start && now < end;
    return now >= start || now < end;              // wraps midnight
  }

  // The next minute at which a reminder may fire. Returns a value beyond one
  // day when the window ends tomorrow, so callers can add it to today's
  // midnight without a separate date calculation.
  function nextAllowed(now, start, end) {
    if (!isQuiet(now, start, end)) return now;
    return now >= end ? end + DAY : end;
  }

  global.KinvtQuietHours = { isQuiet: isQuiet, nextAllowed: nextAllowed, DAY: DAY };
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --test scripts/test/quiet-hours.test.mjs`
Expected: PASS — 5 tests.

- [ ] **Step 5: Declare the Android permissions**

In `mobile/android/app/src/main/AndroidManifest.xml`, inside `<manifest>` and before `<application>`:

```xml
    <!-- Android 13+ requires the user to grant notifications at runtime. -->
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <!-- Reschedule after a reboot, or reminders stop until the app is opened. -->
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
```

Exact-alarm permissions are deliberately **not** requested. Inexact alarms are correct here: study prompts do not need second accuracy, exact alarms are heavily restricted on Android 12+ and require a special-access grant, and they cost noticeably more battery.

- [ ] **Step 6: Write the reminder shim**

Create `mobile/src/shim/reminders.js`:

```js
/*
 * Kinvt-study — Android study reminders.
 *
 * The desktop floats an always-on-top card. Android has no equivalent and
 * should not fake one: the native idiom is a notification that opens the quiz
 * when tapped.
 *
 * Scheduling is a rolling window of individual notifications rather than one
 * repeating alarm, because the interval is a user setting and quiet hours cut
 * holes in the schedule. Each launch clears and re-lays the next few.
 *
 * Reminders are INEXACT by design. Doze batches alarms, so one may arrive a
 * few minutes late; for a study prompt that is correct behaviour and far
 * kinder to the battery than demanding an exact alarm.
 */
(function (global) {
  'use strict';
  if (!global.Capacitor || !global.Capacitor.Plugins || !global.Capacitor.Plugins.LocalNotifications) return;

  var LN = global.Capacitor.Plugins.LocalNotifications;
  var AHEAD = 8;                       // how many reminders to lay out at once
  var CHANNEL = 'kinvt-study';

  function minutesNow(d) { return d.getHours() * 60 + d.getMinutes(); }

  function schedule() {
    var s = global.KinvtQuiz.getSettings();
    if (!s.enabled) return LN.cancel({ notifications: pending() });

    var every = Math.max(15, Math.round(s.intervalMin) || 30);
    var qs = typeof s.quietStart === 'number' ? s.quietStart : 1320;
    var qe = typeof s.quietEnd === 'number' ? s.quietEnd : 420;

    var list = [];
    var when = new Date();
    for (var i = 0; i < AHEAD; i++) {
      when = new Date(when.getTime() + every * 60000);
      var mins = minutesNow(when);
      if (global.KinvtQuietHours.isQuiet(mins, qs, qe)) {
        // Jump to the end of the quiet window rather than dropping the slot,
        // otherwise a long night would consume the whole rolling window and
        // leave nothing scheduled for the morning.
        var next = global.KinvtQuietHours.nextAllowed(mins, qs, qe);
        when = new Date(when.getTime() + (next - mins) * 60000);
      }
      list.push({
        id: 1000 + i,
        title: 'Time for a quick quiz',
        body: s.perQuiz + (s.perQuiz === 1 ? ' question' : ' questions') + ' ready',
        schedule: { at: new Date(when.getTime()), allowWhileIdle: false },
        channelId: CHANNEL,
        smallIcon: 'ic_stat_kinvt'
      });
    }
    return LN.cancel({ notifications: pending() })
      .catch(function () { /* nothing pending */ })
      .then(function () { return LN.schedule({ notifications: list }); });
  }

  function pending() {
    var out = [];
    for (var i = 0; i < AHEAD; i++) out.push({ id: 1000 + i });
    return out;
  }

  function init() {
    return LN.createChannel({
      id: CHANNEL,
      name: 'Study reminders',
      importance: 3,             // default: shows in the shade, no sound intrusion
      visibility: 1
    }).catch(function () { /* older Android has no channels */ })
      .then(function () { return LN.checkPermissions(); })
      .then(function (p) {
        if (p.display === 'granted') return { display: 'granted' };
        return LN.requestPermissions();
      })
      .then(function (p) {
        // Refusal is a valid choice: the app stays fully usable as
        // open-and-practise, it just will not interrupt.
        if (p.display !== 'granted') return null;
        return schedule();
      });
  }

  LN.addListener('localNotificationActionPerformed', function () {
    if (global.KinvtMobile && global.KinvtMobile.startQuiz) global.KinvtMobile.startQuiz();
  });

  global.KinvtReminders = { schedule: schedule, init: init };

  // Re-lay the schedule whenever settings change, or a new interval would not
  // take effect until the existing window drained.
  global.addEventListener('storage', function (e) {
    if (e.key === 'kinvt.settings') schedule();
  });
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 7: Add the quiet-hours settings rows**

In `desktop/ui/settings.html`, inside the first card before its `</section>`:

```html
      <label class="row">
        <span class="lbl">Quiet hours from</span>
        <input type="time" id="quietStart" value="22:00">
      </label>
      <label class="row">
        <span class="lbl">until</span>
        <input type="time" id="quietEnd" value="07:00">
      </label>
```

In `desktop/ui/settings.js`, inside `init`:

```js
    // Stored as minutes since midnight, which sidesteps timezones and dates.
    function toMinutes(v) {
      var p = String(v || '').split(':');
      return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0);
    }
    function toTime(m) {
      var h = Math.floor((m || 0) / 60), mm = (m || 0) % 60;
      return ('0' + h).slice(-2) + ':' + ('0' + mm).slice(-2);
    }

    $('quietStart').value = toTime(settings.quietStart != null ? settings.quietStart : 1320);
    $('quietEnd').value = toTime(settings.quietEnd != null ? settings.quietEnd : 420);
    $('quietStart').addEventListener('change', function () { settings.quietStart = toMinutes(this.value); save(); });
    $('quietEnd').addEventListener('change', function () { settings.quietEnd = toMinutes(this.value); save(); });
```

Add `quietStart: 1320` and `quietEnd: 420` to `DEFAULT_SETTINGS` in `desktop/ui/quiz-engine.js`, and add `quietStart`/`quietEnd` to the **local** (not synced) side of `KinvtMerge.SYNCED_SETTINGS` — they are device behaviour, like `intervalMin`.

- [ ] **Step 8: Add the notification icon**

Android status-bar icons must be a white silhouette on transparent; a full-colour icon renders as a grey square. Create `mobile/android/app/src/main/res/drawable/ic_stat_kinvt.xml`:

```xml
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp"
    android:viewportWidth="24" android:viewportHeight="24">
  <path android:fillColor="#FFFFFFFF"
      android:pathData="M12,2A10,10 0,1 0,22 12,10 10,0 0,0 12,2zM12,18a1.2,1.2 0,1 1,1.2 -1.2A1.2,1.2 0,0 1,12 18zM13.2,13.4v0.6h-2.4v-1.6c0,-1.6 2.6,-1.9 2.6,-3.4a1.4,1.4 0,0 0,-2.8 0h-2a3.4,3.4 0,0 1,6.8 0C15.4,11.1 13.2,11.6 13.2,13.4z"/>
</vector>
```

- [ ] **Step 9: Verify on a device**

Install, grant the notification permission, set the interval to 15 minutes, and leave the device idle.

Expected: a notification arrives at roughly the interval — **not to the second**; Doze may delay it. Tapping it opens the app on a quiz. Set quiet hours to cover the current time and confirm no notification arrives, and that one arrives after the window ends.

- [ ] **Step 10: Commit**

```bash
git add desktop/ui/quiet-hours.js desktop/ui/settings.html desktop/ui/settings.js desktop/ui/quiz-engine.js desktop/ui/merge.js mobile/src/shim/reminders.js mobile/android/app/src/main/AndroidManifest.xml mobile/android/app/src/main/res/drawable/ic_stat_kinvt.xml scripts/test/quiet-hours.test.mjs
git commit -m "Remind you to study on Android, and stay quiet at night"
```

---

### Task 5: The mobile quiz screen

The desktop's frameless floating card does not fit a phone. The same `TPQ_UI.create` renders it, but full-screen.

**Files:**
- Create: `mobile/src/shim/mobile-app.js`
- Create: `mobile/src/shim/mobile.css`
- Modify: `desktop/ui/index.html`

**Interfaces:**
- Consumes: `KinvtQuiz.buildQuiz`, `TPQ_UI.create`, `KinvtStorage.ready`.
- Produces: `global.KinvtMobile.startQuiz()`.

- [ ] **Step 1: Write the mobile controller**

Create `mobile/src/shim/mobile-app.js`:

```js
/*
 * Kinvt-study — the Android quiz screen.
 *
 * The desktop card is a small frameless window that floats over other work and
 * measures itself so the transparent window does not show empty space. None of
 * that applies on a phone, where the app IS the screen: no measuring, no
 * resizing, no always-on-top.
 *
 * What is shared is the part that matters — the same TPQ_UI card, the same
 * question banks, the same recording of answers.
 */
(function (global) {
  'use strict';
  if (!global.Capacitor) return;

  var host = null;

  function ensureHost() {
    if (host) return host;
    host = document.getElementById('card') || document.createElement('div');
    host.id = 'card';
    if (!host.parentNode) document.body.appendChild(host);
    return host;
  }

  function startQuiz() {
    // Storage is hydrated asynchronously on Android, so a quiz launched from a
    // notification tap on a cold start must wait — otherwise it would build
    // itself from an empty cache and ignore every setting and every past
    // answer.
    return global.KinvtStorage.ready()
      .then(function () { return global.KinvtQuiz.buildQuiz(); })
      .then(function (quiz) {
        if (!quiz) return;
        var el = ensureHost();
        el.innerHTML = '';
        global.TPQ_UI.create(el, {
          questions: quiz.questions,
          title: quiz.title,
          durationSec: 0,            // no auto-close: a phone is not a popup
          theme: quiz.theme,
          glass: quiz.glass,
          glassCustom: quiz.glassCustom,
          skipSummary: false,        // on a phone the summary is worth showing
          onAnswer: function (q, ok) { global.KinvtQuiz.recordAnswer(q, ok); },
          onFinish: function (c, t) { global.KinvtQuiz.recordResult(c, t); },
          onClose: function () { el.innerHTML = ''; }
        });
      });
  }

  global.KinvtMobile = { startQuiz: startQuiz };

  document.addEventListener('DOMContentLoaded', function () {
    global.KinvtStorage.ready()
      .then(function () { return global.KinvtReminders ? global.KinvtReminders.init() : null; })
      .then(function () { return global.KinvtQuiz.syncContent(); })
      .catch(function () { /* offline: the bundled banks are what get used */ });
  });
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 2: Add mobile layout**

Create `mobile/src/shim/mobile.css`:

```css
/* The card is a floating window on the desktop and the whole screen here. */
body { padding: 0; margin: 0; background: var(--bg, #1c1b19); }
#card { max-width: 640px; margin: 0 auto; padding: 16px; }

/* Keep content clear of the status bar and the gesture area. */
body { padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom); }

/* Touch targets: the desktop's option rows are sized for a mouse. */
#card .tpq-opt { min-height: 52px; }
```

- [ ] **Step 3: Load the shims in `index.html`**

The desktop ignores them: `mobile-app.js` returns immediately when `Capacitor` is absent, and the CSS 404s harmlessly.

```html
  <link rel="stylesheet" href="shim/mobile.css">
  ...
  <script src="shim/reminders.js"></script>
  <script src="shim/mobile-app.js"></script>
```

placed after `quiz-engine.js` and after `app.js`.

- [ ] **Step 4: Verify on a device**

Rebuild, install, open the app, and tap through a quiz. Then answer a question wrong, close the app, reopen, and confirm the question returns in a later quiz — proving the review queue survives via SharedPreferences.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/shim/mobile-app.js mobile/src/shim/mobile.css desktop/ui/index.html
git commit -m "Render the quiz full-screen on Android, sharing the desktop card"
```

---

### Task 6: Signed release APK, attached to GitHub Releases

**Files:**
- Modify: `mobile/android/app/build.gradle`
- Create: `.github/workflows/release-android.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: a signed APK on every `v*` tag.

- [ ] **Step 1: Add the signing config**

In `mobile/android/app/build.gradle`, inside `android { }`:

```gradle
    signingConfigs {
        release {
            // Supplied by CI or a local gradle.properties that is never
            // committed. Absent locally, the build still produces an unsigned
            // APK rather than failing outright.
            if (project.hasProperty('KINVT_KEYSTORE')) {
                storeFile file(project.property('KINVT_KEYSTORE'))
                storePassword project.property('KINVT_KEYSTORE_PASSWORD')
                keyAlias project.property('KINVT_KEY_ALIAS')
                keyPassword project.property('KINVT_KEY_PASSWORD')
            }
        }
    }
    buildTypes {
        release {
            if (project.hasProperty('KINVT_KEYSTORE')) {
                signingConfig signingConfigs.release
            }
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }
```

`minifyEnabled false` is deliberate: the UI is plain JavaScript inside the webview, untouched by R8, so shrinking buys nothing here and only adds a way for the build to break.

- [ ] **Step 2: Add the release workflow**

Create `.github/workflows/release-android.yml`:

```yaml
name: Release Android

on:
  push:
    tags: ['v*']

permissions:
  contents: write

jobs:
  apk:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '17'

      - name: Build the shared UI into mobile/www
        run: node scripts/build-mobile-www.mjs

      - name: Install
        working-directory: mobile
        run: npm ci

      - name: Sync Capacitor
        working-directory: mobile
        run: npx cap sync android

      # The keystore is stored base64-encoded because Actions secrets are text.
      # Without both secrets present the build still runs and produces an
      # unsigned APK, which is fine for a fork but not for a release.
      - name: Restore the keystore
        env:
          KEYSTORE_B64: ${{ secrets.ANDROID_KEYSTORE_BASE64 }}
        run: |
          if [ -z "$KEYSTORE_B64" ]; then echo "no keystore secret; APK will be unsigned"; exit 0; fi
          echo "$KEYSTORE_B64" | base64 -d > mobile/android/kinvt-release.jks

      - name: Build
        working-directory: mobile/android
        env:
          KS_PASS: ${{ secrets.ANDROID_KEYSTORE_PASSWORD }}
          KEY_ALIAS: ${{ secrets.ANDROID_KEY_ALIAS }}
          KEY_PASS: ${{ secrets.ANDROID_KEY_PASSWORD }}
        run: |
          if [ -f kinvt-release.jks ]; then
            ./gradlew assembleRelease \
              -PKINVT_KEYSTORE=kinvt-release.jks \
              -PKINVT_KEYSTORE_PASSWORD="$KS_PASS" \
              -PKINVT_KEY_ALIAS="$KEY_ALIAS" \
              -PKINVT_KEY_PASSWORD="$KEY_PASS"
          else
            ./gradlew assembleRelease
          fi

      - name: Name the artifact after the tag
        run: |
          src=$(find mobile/android/app/build/outputs/apk/release -name '*.apk' | head -1)
          cp "$src" "Kinvt-study-${{ github.ref_name }}.apk"

      - name: Attach to the release
        uses: softprops/action-gh-release@v2
        with:
          files: Kinvt-study-*.apk
          fail_on_unmatched_files: true

      - name: Remove the keystore from the runner
        if: always()
        run: rm -f mobile/android/kinvt-release.jks
```

- [ ] **Step 3: Create the keystore and store the secrets**

Run locally, once:

```bash
keytool -genkey -v -keystore kinvt-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias kinvt
base64 -w0 kinvt-release.jks > kinvt-release.jks.b64
```

Add four repository secrets: `ANDROID_KEYSTORE_BASE64` (contents of the `.b64` file), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.

Store `kinvt-release.jks` somewhere safe and **do not commit it**. `.gitignore` already excludes `*.jks`.

- [ ] **Step 4: Verify the workflow end to end**

```bash
git tag v1.1.0 && git push origin v1.1.0
gh run watch
```

Expected: the run succeeds and `Kinvt-study-v1.1.0.apk` is attached to the release. Download it on a phone and install — Android will warn about an unknown source, which is expected for a non-Play install.

- [ ] **Step 5: Document it**

Add to the README's Setup section:

```markdown
**Android** — download the `.apk` from [Releases](../../releases) and open it on
your phone. Android will ask you to allow installing from this source. The
app needs no account and no network beyond the daily question sync.
```

- [ ] **Step 6: Commit**

```bash
git add mobile/android/app/build.gradle .github/workflows/release-android.yml README.md
git commit -m "Sign and publish an APK on every version tag"
```

---

## Self-review

**Spec coverage:**

| Spec section (sub-project B) | Task |
|---|---|
| `mobile/www` generated from `desktop/ui` | 1 |
| Capacitor project structure | 2 |
| Durable storage via Preferences | 3 |
| Local notifications, Android 13 permission, inexact alarms | 4 |
| Quiet hours replacing desktop DND | 4 |
| Mobile quiz screen | 5 |
| APK signing and GitHub Releases | 6 |
| iOS not precluded (native code confined to `mobile/src/shim/`) | 3, 4, 5 |

**Type consistency:** `KinvtStorage.setBackend`/`ready` defined in Task 3 are used in Task 5. `KinvtQuietHours.isQuiet`/`nextAllowed` defined in Task 4 are used by `reminders.js` in the same task. `KinvtMobile.startQuiz` defined in Task 5 is called by the notification listener in Task 4 — Task 4 guards with `if (global.KinvtMobile && ...)` precisely because it may load first.

**Known ordering constraint:** Task 1 before Task 2 (the Capacitor project needs `www/` to exist). Task 3 before Task 5 (`startQuiz` awaits `KinvtStorage.ready`).

**Deliberate scope exclusion:** No background *sync* here — sub-project C owns that. This plan's app is complete and useful without ever talking to the desktop.

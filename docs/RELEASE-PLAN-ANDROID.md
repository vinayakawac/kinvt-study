# Android release plan

What stands between the current APK and a Play Store listing, in the order it
should be done, with an honest note on how far each item can actually be
verified from this machine.

Written 2026-08-17. Status at that date: the app builds, runs and is usable on
an emulator; it has never been built as a release, never been signed, and one
of its two headline features (device sync) cannot work on any real device as
shipped.

Three groups:

- **A — code, verifiable here.** Emulator plus the test suite is enough.
- **B — code, verifiable only in part.** Real hardware or a Play-enabled
  device closes the rest.
- **C — not mine to do.** Keys, money, and a hosted URL.

---

## A1. Cleartext HTTP to the LAN — *blocks sync entirely*

**The bug.** `sync-session.js` builds `http://<host>:<port>/v1/sync`. Android
has blocked cleartext by default since Android 9, so on any real device the
fetch fails with `ERR_CLEARTEXT_NOT_PERMITTED` before a byte leaves. Sync is
not "untested" — it cannot work.

This never showed up because the emulator is NAT'd off the LAN, so no sync was
ever attempted from it.

**The fix.** A `network_security_config.xml` permitting cleartext for private
ranges *only* — `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, plus
`10.0.2.2` so the emulator can reach a listener on the host. Referenced from
`<application android:networkSecurityConfig=…>`, applied by
`patch-android-manifest.mjs` since `mobile/android` is regenerated.

Scoping to private ranges matters: `usesCleartextTraffic="true"` would open
plaintext to the whole internet to fix a LAN-only feature, and Play asks about
exactly this.

**Verified by** A2.

---

## A2. A real device-to-device sync — *closes a long-standing unknown*

`scripts/test/sync-transport.test.mjs` already stands up an HTTP listener
shaped exactly like the shells' — same path, same 404, same size cap. Lift its
`listen()` into `scripts/dev-sync-host.mjs`, run it on this machine, and the
emulator reaches it at `10.0.2.2:<port>`. Seed a peer, tap sync.

That is a genuine end-to-end exchange between two independent devices over a
real socket, and it proves A1 at the same time.

**What it does not prove:** that the Tauri and Electron listeners behave like
the Node one (only the shared protocol is exercised), and nothing about
discovery or pairing over real Wi-Fi. Two physical devices remain the only way
to close those.

---

## A3. Decode a generated QR code — *closes the oldest unknown*

`qr.test.mjs` checks finder patterns, timing and quiet zone. It has never
decoded anything, so a systematically wrong mask or wrong format bits would
pass every existing assertion — which is precisely what the handoff suspected.

Add an independent decoder as a **devDependency** and assert
`decode(encode(url)) === url`, over a short string and a full-length pairing
URL (which pushes past version 1 and exercises the version selection).

Independent, deliberately: a decoder written here from the same understanding
as the encoder would share its bugs and prove nothing. This is also stronger
than pointing a camera at a screen — deterministic, and it runs in CI forever.

---

## A4. targetSdk — *a real decision, not a version bump*

Currently `targetSdk 34`, `compileSdk 34`, Capacitor 6.2. Play requires new
submissions to target the previous year's API level, so 34 is short. **Check
Play's current required level before picking a number** — it moves every
August.

The catch: **API 35 enforces edge-to-edge.** The status bar goes transparent
and content draws underneath it. The app already uses `env(safe-area-inset-*)`
throughout, so it may land close — but today's build has an opaque status bar,
so this *will* change how every screen looks and every one needs re-checking.

Two routes:

- **(a) Bump targetSdk on Capacitor 6.** Smaller diff, testable in about an
  hour. Off Capacitor's official support matrix — 6.x targets SDK 34.
- **(b) Upgrade Capacitor 6 → 7 first, then bump.** The supported path. Bigger
  blast radius: all five plugins move together, and the shims get re-verified
  against new plugin APIs.

**(b) for something going to Play.** (a) is a reasonable way to find out how
much edge-to-edge actually costs before committing to the upgrade.

---

## A5. Prove `assembleRelease` works

Only `assembleDebug` has ever run — `app/build/outputs/apk/` contains `debug`
and nothing else. Build an **unsigned release**, install it, walk every screen.
Release-only differences (manifest merge, resource shrinking, the debug-only
webview affordances Capacitor drops) have never once been exercised.

Cheap, and it must happen before signing is worth wiring up.

---

## A6. Version from the tag

`versionCode 1` / `versionName "1.0"` are hardcoded. Play rejects an upload
whose `versionCode` does not exceed the last one, so this needs to be
mechanical before the first update, not after. Derive both from the `v*` tag in
CI.

---

## B1. Reminders through Doze

Testable further than the handoff assumed: `adb shell dumpsys deviceidle
force-idle` puts the emulator into Doze, and whether an inexact alarm survives
it can be observed directly. Worth doing — it is the difference between "we
think reminders work" and "reminders survive Doze on stock Android".

**Never testable here:** OEM battery managers. Xiaomi, Samsung, Oppo and
friends kill background alarms by policy, and no emulator reproduces that. This
stays a known risk to be documented in the listing, not solved in code.

---

## B2. The barcode scanner module download

`scan.js` now installs Google's scanner module on first use, because `scan()`
fails without it on a clean device — found by testing, not by reading docs.
That install path has still never run: this emulator image has no Play
Services to fetch it from.

Needs a **Google Play** system image AVD, or a real phone. One attempt with a
Play-enabled AVD is worth it before assuming a device is required.

---

## B3. minSdk 22

Android 5.1, and the app has only ever run on API 35. ML Kit, adaptive icons
(26+) and webview behaviour on 5.1 are all untested, for a fraction of a
percent of devices.

**Raise it to 26.** It costs nothing real and deletes a whole class of unknowns
rather than carrying them into a release.

---

## C1. The signing keystore — *yours, and only yours*

Generate it, hold it, back it up somewhere that is not this repo. Losing it
means never updating the listing again under the same package name.

```bash
keytool -genkeypair -v -keystore kinvt-release.jks -keyalg RSA -keysize 4096 -validity 10000 -alias kinvt
```

Then set four repository secrets, which the workflow already reads:
`ANDROID_KEYSTORE_BASE64` (the `.jks`, base64), `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Until they exist the workflow logs
a warning and produces an unsigned APK.

The `.jks` must never be committed. `.gitignore` should say so explicitly
before the file exists, not after.

---

## C2. Play Console account

One-time $25, and identity verification that can take days. Start it early —
it is the item most likely to be the actual long pole.

---

## C3. Privacy policy — a hosted URL is required

The text is derivable from what the code actually does, and can be drafted
here: questions bundled on-device, no accounts, no analytics, camera used only
to scan a pairing code, notifications for reminders, no network at runtime
beyond the question sync. Hosting it is the part that needs somewhere to live.

## C4. Data safety declaration

Every answer follows from the manifest permissions and the code paths, so this
can be filled in accurately rather than guessed. Worth doing carefully: a
declaration that does not match observed app behaviour is a suspension risk.

## C5. Store listing assets

Screenshots can be captured from the emulator at the required sizes, and the
copy drafted. The feature graphic needs actual design work.

---

## Suggested order

1. **A1 + A2 together** — the live bug and the test that proves it fixed.
2. **A3** — cheap, and closes the oldest unknown in the project.
3. **A4** — decide the Capacitor route, because A5 and everything after it
   depend on the answer.
4. **A5, A6, B3** — release mechanics, once the SDK level is settled.
5. **C1 + C2 in parallel with all of the above** — they have lead times that
   have nothing to do with code.
6. **B1, B2** — before submitting, not before building.
7. **C3–C5** — last, and only once the app's behaviour has stopped moving.

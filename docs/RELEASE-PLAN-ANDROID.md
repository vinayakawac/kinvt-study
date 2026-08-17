# Android release plan

What stands between the current APK and a Play Store listing, with an honest
note on how far each item can be verified from this machine.

Written 2026-08-17; **A1, A2, A3, A5, A6 and B3 were done that day** and are
kept below with what was actually found, because most of them turned up more
than the plan predicted.

Groups: **A** code, verifiable here — **B** code, verifiable only in part —
**C** not mine to do.

---

## ✅ A1. Cleartext HTTP — *was two bugs, not one*

Sync builds `http://<host>:<port>/v1/sync`, and Android has blocked cleartext
by default since Android 9. Fixed with a `network_security_config.xml` applied
by `patch-android-manifest.mjs`.

**Correction to the original plan**, which claimed the config could be scoped
to private IP ranges: it cannot. `<domain>` entries take hostnames, and the
format has no CIDR syntax, so "permit cleartext on 192.168.0.0/16" is not
expressible. A peer's address is DHCP and cannot be listed ahead of time.

What *is* expressible is the reverse, and that is what shipped: cleartext is
permitted by default, and `githubusercontent.com` — the only host contacted off
the LAN — is pinned to HTTPS so it cannot be downgraded even by a future
`http://` typo. The plaintext carries an already-encrypted envelope; TLS was
never what protected it.

**Then a second, independent blocker appeared** once the first was fixed, and
only because A2 made a real request possible: Capacitor serves the app from
`https://localhost`, so *any* `http://` fetch is active mixed content and
Chromium blocks it before Android's policy is consulted. Neither fix alone
does anything.

Two obvious ways out are both wrong here. `androidScheme: 'http'` drops the app
to an insecure origin and takes `crypto.subtle` with it — and the sync envelope
is encrypted with WebCrypto, so it trades a blocked request for no encryption.
`allowMixedContent: true` re-permits mixed content globally and Capacitor
documents it as not for production. The sync transport now goes through
`CapacitorHttp`, which makes the request from native code where the webview's
rule does not apply, and nothing else in the app changes.

## ✅ A2. A real device-to-device sync

`scripts/dev-sync-host.mjs` stands up the listener the desktop shells run as
its own process; the emulator reaches it at `10.0.2.2`. **A sync completed**:
the phone went from 11 answered / 6 correct to 14 / 8, exactly absorbing the
host's three answers, and the host logged the 200. Repeating it changed
nothing, which is the idempotent merge behaving.

That is the first device-to-device sync in the project's history.

**Still not proven:** that the Tauri and Electron listeners behave like the Node
one — only the shared protocol was exercised — and nothing about discovery or
pairing over real Wi-Fi. Two physical devices remain the only way.

## ✅ A3. Decode a generated QR — *found three real bugs*

The old tests checked finders, timing and quiet zone, and every one passed
while **no code the encoder ever produced could be read by anything.** They
were written from the same understanding as the encoder, so they agreed with
it. `jsqr` is now a devDependency and the tests require the original string
back, across all ten versions.

What it found, in order:

1. **The Reed–Solomon generator polynomial was built backwards.** `rsGenerator`
   emitted coefficients lowest-degree-first while `rsEncode` read them
   highest-first. Degree 1 hid it perfectly — the generator there is `[1, 1]`,
   a palindrome — so the field arithmetic looked sound while every code carried
   error-correction bytes computed from a mirrored polynomial. Syndromes never
   cleared; every scanner rejected it.
2. **No version information block.** Versions 7 and up carry their version in
   two 6×3 blocks beside the finders. It was never written, so everything from
   version 7 on was unreadable.
3. **Two alignment patterns dropped at version 7+.** The loop skipped any
   centre that was already `reserved`, which looks equivalent to the spec's
   rule and is not: centres on row/column 6 sit on the timing lines and are
   reserved, so `(6, mid)` and `(mid, 6)` were silently omitted. Versions 1–6
   have only two centres and no middle one, so nothing was ever lost there —
   which is why the bug waited for version 7.

A pairing URL is about 103 characters, i.e. version 5 or 6, so real codes were
in the range that *would* have worked had bug 1 not made all of them invalid.

Two edits to the format-information placement were made along the way and then
**reverted**: it was correct as written. Indexing from bit 0 up lands the same
modules as the spec's bit-14-down ordering because the two halves of each copy
are walked in opposite directions, so the reversal cancels. Verified module for
module against an independent encoder before reverting.

## ✅ A5. `assembleRelease` proven

It had never once run. It works, and produces a 23.5 MB
`app-release-unsigned.apk`. Signing still needs C1.

## ✅ A6. Version from the tag, and ✅ B3. minSdk

`patch-android-manifest.mjs` now raises minSdk 22 → 26 and, when `KINVT_VERSION`
is set from a `v*` tag in CI, stamps `versionName` and a monotonic
`versionCode` (1.2.3 → 10203). Play rejects an upload whose versionCode does
not increase, so this had to be mechanical before the first update.

---

## A4. targetSdk — *the one real decision, still open*

`targetSdk 34`, `compileSdk 34`, Capacitor 6.2. Play requires new submissions
to target the previous year's API level. **Check Play's current required level
before picking a number** — it moves every August.

API 35 enforces edge-to-edge: the status bar goes transparent and content draws
underneath. The CSS already uses `env(safe-area-inset-*)`, so it may land
close, but today's build has an opaque status bar, so this *will* change every
screen and every one needs rechecking.

- **(a) Bump targetSdk on Capacitor 6.** Small, testable in about an hour. Off
  Capacitor's support matrix — 6.x targets SDK 34.
- **(b) Upgrade Capacitor 6 → 7 first.** The supported path. All five plugins
  move together and the shims get re-verified.

**(b) for something going to Play.** (a) is a cheap way to find out what
edge-to-edge costs before committing.

## B1. Reminders through Doze

Testable further than assumed: `adb shell dumpsys deviceidle force-idle` puts
the emulator into Doze directly. Never testable here: OEM battery managers.
Xiaomi, Samsung and friends kill background alarms by policy, and no emulator
reproduces it. Document it in the listing; it is not fixable in code.

## B2. The barcode scanner module download

`scan.js` installs Google's scanner module on first use, because `scan()` fails
without it on a clean device — found by testing, not by reading docs. That
install path has still never run: this emulator image has no Play Services to
fetch from. Try a **Google Play** system image AVD before assuming a real phone
is required.

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
a warning and produces an unsigned APK. The `.jks` must never be committed —
`.gitignore` should say so before the file exists, not after.

## C2. Play Console account

One-time $25 plus identity verification that can take days. Start it early; it
is the most likely long pole.

## C3–C5. Privacy policy, Data safety, store assets

The policy text is derivable from what the code does — questions bundled
on-device, no accounts, no analytics, camera only for pairing, notifications
for reminders, no network at runtime beyond the question sync — and can be
drafted here; hosting it is the part that needs somewhere to live. Data safety
answers follow from the manifest permissions and the code paths, so they can be
filled in accurately rather than guessed; a declaration that does not match
observed behaviour is a suspension risk. Screenshots can be captured from the
emulator; the feature graphic needs design.

---

## What is left, in order

1. **A4** — decide the Capacitor route. Everything about the release variant
   depends on it.
2. **C1 + C2** — in parallel, they have lead times unrelated to code.
3. **B1, B2** — before submitting, not before building.
4. **C3–C5** — last, once behaviour has stopped moving.

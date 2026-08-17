# Handoff — Android

Paste this into a new session working on the Android app.

---

I'm continuing work on **Kinvt-study**, an offline MCQ quiz app for Indian
competitive-exam prep. Repo: `X:\.projectz\kinvtstudy`, GitHub
`vinayakawac/kinvt-study`, branch `main`. Everything below is committed and
pushed. **This session is Android only** — a separate session owns the desktop.

## What the Android app is

Capacitor 6 wrapping the shared web UI. There is no separate mobile codebase:
`desktop/ui/` is the single source of truth, and `scripts/build-mobile-www.mjs`
generates `mobile/www/` from it, injecting mobile-only shims. `mobile/www/` and
`mobile/android/` are both **generated and gitignored** — never edit them.

```
mobile/src/shim/          the only hand-written mobile code
  mobile-nav.js           bottom tab bar; MOVES existing <section> cards into screens
  mobile-quiz.js          the Android quiz renderer (KinvtQuizUI)
  mobile-app.js           overlay + startQuiz + back button + reminders init
  storage-native.js       swaps KinvtStorage to Capacitor Preferences
  reminders.js            local notifications, quiet hours aware
  scan.js                 QR pairing via camera
  mobile.css              app shell, tabs, quiz styling
```

### Build and test locally

The toolchain is installed on this machine — JDK 21 at
`C:\Program Files\Eclipse Adoptium\jdk-21.0.12.8-hotspot`, Android SDK at
`C:\Android\sdk`. `JAVA_HOME` and `ANDROID_HOME` are set as user variables.

```bash
node scripts/build-mobile-www.mjs
cd mobile && npm install          # first time
npx cap add android               # first time, or after deleting mobile/android
node ../scripts/patch-android-manifest.mjs   # re-run after EVERY cap add
npx cap sync android
cd android && ./gradlew assembleDebug --no-daemon
```

APK lands in `mobile/android/app/build/outputs/apk/debug/`.

**Emulator** `kinvt-test` (Pixel 6, Android 15) is already created:

```bash
C:\Android\sdk\emulator\emulator.exe -avd kinvt-test -no-snapshot-save -gpu swiftshader_indirect
C:\Android\sdk\platform-tools\adb.exe install -r <apk>
```

Boot takes ~90s. Screenshot with
`adb exec-out screencap -p > out.png`, then read the PNG.

## What works, verified on the emulator

- App renders: **Home / Library / Progress / Settings** bottom tabs
- Quiz opens full-screen, answering records, explanation shows, Next advances
- **Lightning mode on by default** — reached Question 7 with `perQuiz=3`,
  i.e. two silent refills with no summary between
- Source links open the browser
- Notification permission prompt fires
- Progress persists in SharedPreferences, surviving a webview cache clear

## What is NOT verified — do these first

1. **Does the QR pairing code actually scan?** `qr.js` is a from-scratch
   encoder (the CSP forbids a CDN). Finder patterns, timing and quiet zone all
   test correct, but nothing has ever decoded one. If it fails, suspect the
   mask and format bits — it uses mask 0 with hardcoded format bits.
2. **Does a real phone↔desktop sync complete?** The protocol passes 22 unit
   tests and a real-socket test, but has never run device-to-device. The
   emulator is NAT'd off the LAN so it cannot test this.
3. **Do reminders actually fire?** Doze and OEM battery managers are outside
   the app's control. Alarms are inexact by design.

## Gotchas that cost me time

- **`storage-native.js` must load AFTER `storage.js` and BEFORE `progress.js`.**
  Anywhere else it finds no `KinvtStorage`, silently no-ops, and Android quietly
  falls back to the localStorage it exists to replace. Ordering is enforced in
  `build-mobile-www.mjs`'s `injectShims`.
- **The viewport meta tag is injected by the build**, not present in
  `desktop/ui/`. Without it Android assumes a ~980px page and scales everything
  to about a third size.
- **`index.html` in `mobile/www/` is built from `settings.html`, not from
  `desktop/ui/index.html`.** That file is the desktop's transparent quiz window
  and renders as a blank screen on a phone. This was a real shipped bug.
- **Never run scripted regex/`sed` surgery over source files.** It produced
  broken code four separate times in one session — a mangled regex that crashed
  the exe, unbalanced parens, degree symbols turned into `2`s, and stripped
  quotes that made `getElementById(card)` return null. Use the Edit tool.

## Before committing

```bash
node scripts/check-syntax.mjs         # parses every shipped .js
node scripts/build-mobile-www.mjs --check
node scripts/check-ui-scripts.mjs
node scripts/check-shell-parity.mjs
node --test scripts/test/*.test.mjs   # 104 tests
```

CI (`.github/workflows/android.yml`) builds the APK on every push and attaches
a signed one to `v*` tags — that needs four `ANDROID_*` repo secrets which are
**not** set yet, so tagged releases currently produce an unsigned APK.

## Reasonable next steps

- Verify the three unverified items above on a real phone
- iOS: deliberately deferred, but Capacitor keeps it reachable — needs a Mac
- Play Store listing (one-time $25); the signing config is already in
  `patch-android-manifest.mjs`

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
  mobile-settings.js      strips the desktop-only controls; rewires pairing
  touch.js                press states, ripples, haptics — see below
  storage-native.js       swaps KinvtStorage to Capacitor Preferences
  reminders.js            local notifications, quiet hours aware
  scan.js                 QR pairing via camera, over CapacitorHttp
  mobile.css              app shell, tabs, quiz styling
```

`touch.js` exists because CSS `:active` cannot tell a press from the start of a
flick, so buttons stayed lit while a list scrolled out from under them. It
tracks the pointer and releases when the finger travels. `mobile.css` also
takes the scrollbar out of the layout — this webview renders a classic
space-taking one, which reserved width on the right edge only and left every
card visibly off-centre against the tab bar.

### Build and test locally

The toolchain is installed on this machine — JDK 21 at
`C:\Program Files\Eclipse Adoptium\jdk-21.0.12.8-hotspot`, Android SDK at
`C:\Android\sdk`. `JAVA_HOME` and `ANDROID_HOME` are set as user variables.

```bash
node scripts/build-mobile-www.mjs
cd mobile && npm install          # first time
npx cap add android               # first time, or after deleting mobile/android
node ../scripts/patch-android-manifest.mjs   # re-run after EVERY cap add
node ../scripts/make-android-icons.mjs       # likewise — else you ship Capacitor's stock icon
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

## Resolved since this handoff was written (2026-08-17)

The first two items on the old "not verified" list were not merely unverified —
both were broken, and finding out took making them testable.

1. **The QR encoder produced nothing any scanner could read.** Three bugs, all
   invisible to the structural tests that existed: the Reed–Solomon generator
   polynomial was built backwards (degree 1 hid it — `[1,1]` is a palindrome),
   versions 7+ never got their version information block, and versions 7+ also
   lost two alignment patterns because the loop skipped centres that were
   already `reserved`, which is what centres on the timing lines always are.
   `jsqr` is now a devDependency and the tests decode every version 1–10.
   The format-bit placement, the original prime suspect, was correct.
2. **Sync could not work on any real device**, for two independent reasons.
   Android blocks cleartext HTTP by default, and Capacitor serves the app from
   `https://localhost`, which makes any `http://` fetch active mixed content
   that Chromium blocks before Android's policy is even consulted. Fixed with a
   network security config plus routing the sync through `CapacitorHttp`.
   `scripts/dev-sync-host.mjs` now runs the shells' listener as its own
   process, reachable from the emulator at `10.0.2.2`, and a **real
   device-to-device sync completes**.

## What is NOT verified — do these first

1. **Does a scan work end to end on a real phone?** The encoder is proven by
   decode tests, and the camera path opens, but `scan()` needs Google's barcode
   module, which this emulator image has no Play Services to fetch. `scan.js`
   installs it on first use; that code has never run.
2. **Does sync work over real Wi-Fi, against the Tauri and Electron
   listeners?** Only the shared protocol has been exercised, against a Node
   listener over the emulator's host loopback. Discovery and pairing on an
   actual LAN are still untested.
3. **Do reminders actually fire?** Doze is testable here — `adb shell dumpsys
   deviceidle force-idle` — and has not been done yet. OEM battery managers
   (Xiaomi, Samsung, Oppo) are outside the app's control and no emulator
   reproduces them. Alarms are inexact by design.

See [RELEASE-PLAN-ANDROID.md](RELEASE-PLAN-ANDROID.md) for the full picture.

## Gotchas that cost me time

- **A plain `fetch()` to `http://` cannot work from this app, ever.** Capacitor
  serves from `https://localhost`, so it is active mixed content and Chromium
  blocks it — separately from, and before, Android's cleartext policy. Use
  `CapacitorHttp`. Do not "fix" it with `androidScheme: 'http'`: that drops the
  app to an insecure origin and takes `crypto.subtle` with it, and the sync
  envelope is encrypted with WebCrypto.
- **`mobile-settings.js` must run after `settings.js` has bound its handlers.**
  It removes the desktop-only controls, and removing them earlier leaves
  `settings.js` calling `addEventListener` on null, which takes the whole
  settings page down.
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

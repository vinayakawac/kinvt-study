
## Building the APK locally

The toolchain is installed on this machine:

- **JDK 21** (Temurin) at `C:\Program Files\Eclipse Adoptium\jdk-21.0.12.8-hotspot`
- **Android SDK** at `C:\Android\sdk` — platform 35, build-tools 35, platform-tools

Both `JAVA_HOME` and `ANDROID_HOME` are set as user environment variables, so a
new terminal picks them up. Then:

```bash
cd mobile
npm install            # first time only
npx cap add android    # first time only; regenerates android/
npx cap sync android
cd android && ./gradlew assembleDebug
```

The APK lands in `mobile/android/app/build/outputs/apk/debug/`.

First build takes about three minutes while Gradle downloads its dependencies;
later builds are far quicker. `mobile/android/` is gitignored and regenerated,
so `patch-android-manifest.mjs` must be re-run after any `cap add android` to
restore the permissions and signing config, and `make-android-icons.mjs` to
redraw the launcher icons from the desktop mark — without it the APK ships
Capacitor's stock icon while the desktop shows the real one.

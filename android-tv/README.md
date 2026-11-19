# Masjid Pulse — Android TV app

A small Kotlin shell (no Leanback library needed) that shows the Masjid Pulse TV display full-screen.
The TV web app (`public/tv` + brand assets) is **bundled in the APK** and served from
`https://appassets.androidplatform.net/` by `WebViewAssetLoader`, so the app opens instantly and works
offline from the very first launch; it talks to the configured server only for pairing and snapshot
updates (`?api=<server>`). The last published snapshot and the device token live in WebView
localStorage, so the display keeps running through internet outages and reboots, and computes prayer
times for days beyond the published window from the snapshot's embedded calculation settings.

| Feature                       | How                                                                                                                                                                                                                                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Android TV / Fire TV launcher | `LEANBACK_LAUNCHER` + `LAUNCHER` intent filters, 320×180 banner (`res/drawable-xhdpi/banner.png`, from the stacked logo), launcher icons from the TV emblem; `leanback`/`touchscreen` not required, so it also installs on Fire TV and other boxes                   |
| minSdk 21                     | Android 5.0+ (older Fire TV sticks); targetSdk/compileSdk 34                                                                                                                                                                                                         |
| Keep screen on                | `FLAG_KEEP_SCREEN_ON` (+ show when locked / turn screen on), immersive full-screen                                                                                                                                                                                   |
| Auto-start on boot            | `BootReceiver` for `BOOT_COMPLETED`, `QUICKBOOT_POWERON` (Fire TV/some boxes), `MY_PACKAGE_REPLACED`                                                                                                                                                                 |
| Restart on crash              | `MasjidPulseApp` uncaught-exception handler schedules a restart via `AlarmManager` (crash-loop guard: max 3 in 60 s); a crashed/killed WebView renderer (`onRenderProcessGone`) is rebuilt in place                                                                  |
| Configurable server           | First launch asks for the server address (e.g. `https://pulse.example.org` or `http://192.168.1.20:3000`). Later: press **MENU**, **BACK** or hold **OK** for 1.5 s → change server / _Reset pairing_ / _Exit app_. Bake a default in with `-PmpServerUrl=https://…` |
| Kiosk-ish                     | BACK does not leave the display; it opens the settings dialog                                                                                                                                                                                                        |

## Build

Requirements: JDK 17, Android SDK (platform-tools, build-tools 34.0.0, platforms;android-34). The
Gradle wrapper (8.7, AGP 8.5.2, Kotlin 1.9.24) is included.

```bash
# from the repo root: build the TV bundle that gets copied into the APK
npm install && npm run build:web
cd android-tv
export JAVA_HOME=/path/to/jdk17 ANDROID_HOME=/path/to/android-sdk
./gradlew testDebugUnitTest lintDebug assembleDebug   # app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease                             # app/build/outputs/apk/release/app-release.apk
```

The `copyWebAssets` task copies `../public/{tv,brand,icons}` into the APK assets on every build (it
fails with a clear message if `public/tv/app.js` has not been built).

### Release signing

The release build is signed only if `~/.masjid-pulse-keys/keystore.properties` exists (override with
`-PmpKeystoreProps=/path/keystore.properties`). It must contain `storeFile`, `storePassword`,
`keyAlias`, `keyPassword`. **Keystores and passwords are never stored in this repository** (`*.jks`,
`keystore.properties` are git-ignored). Create one with:

```bash
mkdir -p ~/.masjid-pulse-keys && chmod 700 ~/.masjid-pulse-keys
keytool -genkeypair -keystore ~/.masjid-pulse-keys/upload.jks -storetype PKCS12 \
  -alias masjid-pulse-upload -keyalg RSA -keysize 3072 -validity 10000
```

Keep a backup of the keystore: updates to an installed app must be signed with the same key.

## Install on a TV

Enable _Developer options → USB/ADB debugging_ (Fire TV: _Apps from unknown sources_), then
`adb connect <tv-ip>:5555 && adb install -r masjid-pulse-tv.apk`, or sideload with "Downloader".

**Auto-start on Android 10+**: Android blocks activity starts from the background unless the app may
"Display over other apps". Grant it once: _Settings → Apps → Masjid Pulse → Display over other apps_,
or `adb shell appops set com.masjidpulse.tv SYSTEM_ALERT_WINDOW allow`. Android 5–9 and most Fire TV
devices auto-start without this.

**Server requirements**: the TV page is loaded from the APK, so `/api/tv/*` sends CORS headers
(already done by the server). Plain-HTTP LAN servers are allowed (`network_security_config.xml`) —
prefer HTTPS over the internet.

## Limitations

- Slide images are fetched from the server; WebView's HTTP cache usually keeps them, but there is no
  service worker inside the app (the bundled page already provides offline start-up).
- Not published to Google Play / Amazon Appstore; sideload only.

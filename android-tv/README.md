# Masjid Pulse — Android apps

## Native Salat Alert phone app (`mobile/`)

A standalone Android 8.0+ phone app (`com.masjidpulse.salat`) calculates prayer times on the device and
delivers a separate silent notification, system-sound notification, or user-selected Adhan recording
for each of Fajr, Dhuhr, Asr, Maghrib, and Isha. It does not require a Masjid Pulse account or server.

### Build and install

Requirements are the same as for the TV app: JDK 17, Android SDK platform/build-tools 34, and the
included Gradle wrapper. From `android-tv/`:

```bash
./gradlew :mobile:testDebugUnitTest :mobile:lintDebug :mobile:assembleDebug
adb install -r mobile/build/outputs/apk/debug/mobile-debug.apk
```

The debug APK uses Android's debug signing. Mobile release signing and store publishing are not
configured by this module; do not add keystores or passwords to the repository.

### Setup and operation

1. Choose **Use my location**, **Find city**, or enter latitude/longitude manually. Verify the IANA
   timezone (for example `Africa/Mogadishu`) before saving. GPS fills the phone's current timezone;
   city/coordinate entry does not infer it. City lookup uses Android's system Geocoder, so availability
   and network behavior depend on the device provider.
2. Select a trusted calculation method, Asr madhab, and high-latitude rule. Calculation uses Batoul
   Apps Adhan 1.2.1 and does not need a network connection.
3. Enable each prayer independently and select **Silent notification**, **Notification sound**, or
   **Play selected Adhan**. Select an audio file through Android's document picker before using Adhan
   mode. No Adhan recording is bundled; choose a recording you are permitted to use. Without a readable
   selected file, the app falls back to the standard notification sound.
4. Allow notifications. On Android 12+, also allow **Alarms & reminders** for exact timing. If exact
   alarms are denied, the app explicitly uses approximate alarms instead, which Android may delay.
5. Tap **Save & schedule alerts**. **Send a test alert** uses the first enabled prayer and reports
   blocked notifications instead of claiming that an invisible notification was sent.

The rolling 35-day timetable and alarms are generated and stored locally. The schedule refreshes when
the app opens, after an alert, after reboot or app replacement, and after time, timezone, or exact-alarm
permission changes. Alert delivery does not require internet access. Android/OEM battery restrictions,
force-stop, disabled notification channels, revoked permissions, and approximate-alarm fallback can
still affect delivery; check the on-screen status and test the chosen alert style on the actual phone.

Settings, coordinates, alert preferences, and the selected document URI are stored only in private app
preferences. Android cloud backup is disabled for this module. The app has no analytics, account,
location-history service, or Masjid Pulse server dependency. Optional Qibla, widgets, prayer tracking,
nearby mosques, and community features are not part of this module.

## Android TV app (`app/`)

A small Kotlin shell (no Leanback library needed) that shows the Masjid Pulse TV display full-screen.
The TV web app (`public/tv` + brand assets) is **bundled in the APK** and served from
`https://appassets.androidplatform.net/` by `WebViewAssetLoader`, so the app opens instantly and works
offline from the very first launch; it talks to the configured server only for pairing and snapshot
updates (`?api=<server>`). The last published snapshot and the device token live in WebView
localStorage, so the display keeps running through internet outages and reboots, and computes prayer
times for days beyond the published window from the snapshot's embedded calculation settings.

| Feature                       | How                                                                                                                                                                                                                                                |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Android TV / Fire TV launcher | `LEANBACK_LAUNCHER` + `LAUNCHER` intent filters, 320×180 banner (`res/drawable-xhdpi/banner.png`, from the stacked logo), launcher icons from the TV emblem; `leanback`/`touchscreen` not required, so it also installs on Fire TV and other boxes |
| minSdk 21                     | Android 5.0+ (older Fire TV sticks); targetSdk/compileSdk 34                                                                                                                                                                                       |
| Keep screen on                | `FLAG_KEEP_SCREEN_ON` (+ show when locked / turn screen on), immersive full-screen                                                                                                                                                                 |
| Auto-start on boot            | `BootReceiver` for `BOOT_COMPLETED`, `QUICKBOOT_POWERON` (Fire TV/some boxes), `MY_PACKAGE_REPLACED`                                                                                                                                               |
| Restart on crash              | `MasjidPulseApp` uncaught-exception handler schedules a restart via `AlarmManager` (crash-loop guard: max 3 in 60 s); a crashed/killed WebView renderer (`onRenderProcessGone`) is rebuilt in place                                                |
| Configurable server           | First launch asks for the server address (e.g. `https://pulse.example.org`). Later: press **MENU**, **BACK** or hold **OK** for 1.5 s → change server / _Reset pairing_ / _Exit app_. Bake a default in with `-PmpServerUrl=https://…`             |
| Kiosk-ish                     | BACK does not leave the display; it opens the settings dialog                                                                                                                                                                                      |

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
(already done by the server). Configured servers must use HTTPS. Cleartext is restricted to
`localhost`, `127.0.0.1`, and the Android emulator's `10.0.2.2` host for local development;
arbitrary private-LAN HTTP addresses are not exempted (`network_security_config.xml`).

## Limitations

- Slide images are fetched from the server; WebView's HTTP cache usually keeps them, but there is no
  service worker inside the app (the bundled page already provides offline start-up).
- Not published to Google Play / Amazon Appstore; sideload only.

## Third-party notice — Batoul Apps Adhan

The `mobile/` module includes `com.batoulapps.adhan:adhan:1.2.1`, a pure-Java prayer-time calculation
library licensed under the MIT License. No Adhan audio, dataset, or font is bundled with the module.

MIT License

Copyright © 2016 Batoul Apps

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense,
and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial
portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

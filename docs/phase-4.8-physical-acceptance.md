# Phase 4.8 — Physical acceptance register

CI is green on `main` (Node pipeline + Android TV emulator suite). That does not close Phase 4.8.
This register is filled only after a real deployment and a physical Android TV.

Status: **0 / 9 — not started**

## Prerequisites

1. Backend reachable from the TV (not `localhost`). Docker or Fly.io.
2. Signed release APK (`~/.masjid-pulse-keys/keystore.properties` present).
3. TV with ADB debugging enabled.

## Commands (from repo root)

```bash
# Health
curl https://YOUR-APP-NAME.fly.dev/api/health

# Release
npm install && npm run build:web
cd android-tv && ./gradlew assembleRelease
# APK: android-tv/app/build/outputs/apk/release/app-release.apk

# Install
adb connect TV_IP:5555
adb install -r android-tv/app/build/outputs/apk/release/app-release.apk
adb shell appops set com.masjidpulse.tv SYSTEM_ALERT_WINDOW allow
adb shell am start -n com.masjidpulse.tv/.MainActivity
```

## Register

| # | Test | Action | Required evidence | Result | Notes |
|---|------|--------|-------------------|--------|-------|
| 01 | Installation | Install release APK | App installs and opens |  |  |
| 02 | First launch | Enter production server URL | Pairing screen appears |  |  |
| 03 | Pairing | Enter 5-digit code in Admin → Devices | TV exits pairing |  |  |
| 04 | Publishing | Admin → Today → Publish to TVs | Display updates within ~30 s |  |  |
| 05 | Offline | Disconnect Wi-Fi or Ethernet | Last published times remain visible |  |  |
| 06 | Cold boot | Unplug 10 s, restore power | App restores without internet |  |  |
| 07 | Next-day Fajr | Leave running across midnight | Correct next-day Fajr |  |  |
| 08 | Recovery | Restore internet after outage | TV receives updated snapshot |  |  |
| 09 | Signature | `apksigner verify --verbose` on release APK | Signature valid |  |  |

## On failure

```bash
adb logcat -c
adb shell am force-stop com.masjidpulse.tv
adb shell am start -n com.masjidpulse.tv/.MainActivity
adb logcat -d -s MasjidPulse AndroidRuntime chromium '*:E'
```

Paste that log. Do not mark a row until the physical action is done.

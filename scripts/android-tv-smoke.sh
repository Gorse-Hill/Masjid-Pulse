#!/usr/bin/env bash
set -euo pipefail

echo "=== Install APK ==="
adb install -r android-tv/app/build/outputs/apk/debug/app-debug.apk

echo "=== Launch MainActivity ==="
adb shell am force-stop com.masjidpulse.tv || true
adb shell am start -n com.masjidpulse.tv/.MainActivity

echo "=== Wait for process ==="
found=0
for i in $(seq 1 18); do
  if adb shell pidof com.masjidpulse.tv >/dev/null 2>&1; then
    echo "Process found on attempt $i"
    adb shell pidof com.masjidpulse.tv
    found=1
    break
  fi
  echo "No process yet (attempt $i)"
  sleep 5
done

echo "=== Diagnostics ==="
adb shell dumpsys activity activities | grep -E 'com.masjidpulse.tv|mResumedActivity|mFocusedApp' || true
adb shell dumpsys window windows | grep -E 'mCurrentFocus|mFocusedApp' || true
adb logcat -d -s MasjidPulse AndroidRuntime chromium > android-tv-runtime.log || true
adb exec-out screencap -p > android-tv-runtime.png || true

if [ "$found" -ne 1 ]; then
  echo "ERROR: com.masjidpulse.tv process not running after wait"
  exit 1
fi

echo "=== Smoke passed ==="

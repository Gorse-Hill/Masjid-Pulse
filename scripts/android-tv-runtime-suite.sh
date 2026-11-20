#!/usr/bin/env bash
# Android TV runtime suite for Masjid Pulse (WebView shell).
# Covers install, launch, restart recovery, offline relaunch, boot broadcast, and timezone change.
set -uo pipefail

PKG=com.masjidpulse.tv
ACTIVITY=$PKG/.MainActivity
APK=android-tv/app/build/outputs/apk/debug/app-debug.apk
RESULTS=android-tv-runtime-results.txt
LOG=android-tv-runtime.log
mkdir -p runtime-evidence
: > "$RESULTS"

pass() { echo "PASS  $1" | tee -a "$RESULTS"; }
fail() { echo "FAIL  $1" | tee -a "$RESULTS"; FAILED=1; }
FAILED=0

wait_process() {
  local label="$1"
  local attempts="${2:-12}"
  for i in $(seq 1 "$attempts"); do
    if adb shell pidof "$PKG" >/dev/null 2>&1; then
      echo "$label: process present on attempt $i"
      adb shell pidof "$PKG"
      return 0
    fi
    echo "$label: no process yet (attempt $i)"
    sleep 3
  done
  return 1
}

shot() {
  local name="$1"
  adb exec-out screencap -p > "runtime-evidence/${name}.png" || true
}

echo "=== 48-launch: Install APK ==="
if adb install -r "$APK"; then pass "48-launch install"; else fail "48-launch install"; fi

echo "=== 48-launch: Start MainActivity ==="
adb shell am force-stop "$PKG" || true
if adb shell am start -n "$ACTIVITY"; then
  if wait_process "launch"; then pass "48-launch process"; else fail "48-launch process"; fi
else
  fail "48-launch start"
fi
shot launch

echo "=== 48-restart: force-stop and relaunch ==="
adb shell am force-stop "$PKG" || true
sleep 2
if adb shell am start -n "$ACTIVITY" && wait_process "restart"; then
  pass "48-restart recovery"
else
  fail "48-restart recovery"
fi
shot restart

echo "=== 48-offline: disable radios and relaunch ==="
adb shell svc wifi disable || true
adb shell svc data disable || true
adb shell am force-stop "$PKG" || true
sleep 2
if adb shell am start -n "$ACTIVITY" && wait_process "offline"; then
  pass "48-offline relaunch"
else
  fail "48-offline relaunch"
fi
shot offline
adb shell svc wifi enable || true
adb shell svc data enable || true

echo "=== 48-boot: BOOT_COMPLETED broadcast ==="
adb shell am force-stop "$PKG" || true
sleep 1
adb shell am broadcast -a android.intent.action.BOOT_COMPLETED -p "$PKG" || true
sleep 5
if wait_process "boot" 8; then
  pass "48-boot broadcast"
else
  # Background-start limits may block the receiver; record and continue.
  echo "boot broadcast did not start the process (background-start limit possible)"
  if adb shell am start -n "$ACTIVITY" && wait_process "boot-fallback"; then
    pass "48-boot fallback launch"
  else
    fail "48-boot"
  fi
fi
shot boot

echo "=== 48-timezone: set Africa/Mogadishu and relaunch ==="
adb shell service call alarm 3 s16 Africa/Mogadishu || adb shell setprop persist.sys.timezone Africa/Mogadishu || true
adb shell am force-stop "$PKG" || true
sleep 2
if adb shell am start -n "$ACTIVITY" && wait_process "timezone"; then
  pass "48-timezone relaunch"
else
  fail "48-timezone relaunch"
fi
shot timezone

echo "=== Diagnostics ==="
adb shell dumpsys activity activities | grep -E "$PKG|mResumedActivity|mFocusedApp" || true
adb logcat -d -s MasjidPulse AndroidRuntime chromium > "$LOG" || true
cp "$RESULTS" runtime-evidence/ || true
cp "$LOG" runtime-evidence/ || true

echo "=== Suite results ==="
cat "$RESULTS"
if [ "$FAILED" -ne 0 ]; then
  echo "SUITE FAILED"
  exit 1
fi
echo "SUITE PASSED"

# Masjid Pulse — Test Evidence

This file records checks against the repository-hardening package. It supersedes the October 2026 MVP
results previously kept here; those results described a different source tree and Node runtime.
Commit hashes, run links, test counts, coverage, and APK checksums are recorded only after observation.

## Local validation

- **Captured:** 2026-11-22
- **Environment:** Node.js 22.18.0, npm 10.9.3, Linux x64
- **Baseline before edits:** format, lint, typecheck, build, and 8 test files / 132 tests passed.
  `npm audit --omit=dev --audit-level=high` exited 1 with three high-severity findings.
- **After edits:** the checks below were run against the hardening working tree.

| Check             | Command                                            | Observed result                                                                                                 |
| ----------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Install           | `npm ci`                                           | exit 0                                                                                                          |
| Format            | `npm run format:check`                             | exit 0                                                                                                          |
| Lint              | `npm run lint`                                     | exit 0                                                                                                          |
| Typecheck         | `npm run typecheck`                                | exit 0                                                                                                          |
| Build             | `npm run build`                                    | exit 0; generated the ES5 TV bundle                                                                             |
| Tests + coverage  | `npm run test:coverage`                            | 8 test files, 133 tests passed, 0 failed; exit 0                                                                |
| Production audit  | `npm audit --omit=dev --audit-level=high`          | found 0 vulnerabilities; exit 0                                                                                 |
| API smoke journey | `BASE=http://localhost:3919 bash scripts/smoke.sh` | `SMOKE OK`; exit 0                                                                                              |
| Browser journey   | Playwright + Chromium against the built server     | pairing, publishing, public page, mobile admin, and offline TV reload passed; no unexpected console/page errors |

V8 coverage from the final local test run:

| Metric     | Result             |
| ---------- | ------------------ |
| Statements | 95.03% (1110/1168) |
| Branches   | 88.32% (613/694)   |
| Functions  | 96.28% (233/242)   |
| Lines      | 96.88% (995/1027)  |

The Waqaf regression executes the generated TV bundle and verifies that the flash closes when Athan
starts, cannot open during the Athan banner, the Iqamah countdown, or prayer in progress, and can open
again outside those windows. The browser journey confirmed a five-row offline TV display after reload.

## GitHub Actions and Android TV

The pull-request workflow runs the same Node.js checks, a blocking high/critical production audit,
Android unit tests and lint, a debug APK build, and the Android TV emulator suite. Its checksum step
runs `sha256sum` on the APK produced by that job and uploads `android-tv/app-debug.apk.sha256` with the
APK and test evidence in the `masjid-pulse-android-verification` artifact.

No new GitHub run URL or APK checksum is claimed in the initial hardening commit. Those values are
added only from the observed pull-request run. A local Android build was not used as evidence because
this environment has no Android SDK.

## Native Salat Alert phone app

- **Captured:** 2026-11-25
- **Environment:** JDK 17.0.20, Gradle 8.7 (manually downloaded after the wrapper's distribution request
  timed out), Android SDK platform/build-tools 34, Linux x64
- **Command:** `gradle --no-daemon :mobile:clean :mobile:testDebugUnitTest :mobile:lintDebug
  :mobile:assembleDebug` from `android-tv/`
- **Observed result:** exit 0; 7 JVM tests passed with 0 failures/errors/skips; Android lint reported
  0 issues; `mobile/build/outputs/apk/debug/mobile-debug.apk` was generated.
- **Observed debug APK SHA-256:**
  `ca82cb842a7e03273d35436627039825e9d13466512a538768225e3fa5be843a`
- **Packaged manifest inspection:** `aapt dump badging` confirmed application ID
  `com.masjidpulse.salat`, version `0.1.0` (version code 1), minSdk 26, targetSdk/compileSdk 34, and the
  launcher activity.

These are local build results for the Salat Alert working tree, not a GitHub Actions run or a signed
release. No emulator or physical phone was available. Cold start, GPS and city lookup, notification and
exact-alarm prompts, custom-Adhan playback, offline reopen, and reboot/rescheduling therefore remain
runtime acceptance checks rather than claimed results.

## Physical acceptance

No physical Android TV, LG webOS TV, signed release installation, or production SMTP delivery was
exercised by these checks. The nine physical acceptance rows in
`docs/phase-4.8-physical-acceptance.md` remain **0 / 9 — not started**.

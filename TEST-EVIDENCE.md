# Masjid Pulse — Test Evidence

Every block below is raw output captured on this machine. Nothing has been edited except stripping
terminal colour codes. Numbers that are not in these outputs are not claimed.

- **Captured:** 2026-10-11 17:18:29 EAT (UTC+03:00) (box clock)
- **Code commit tested:** `c09835e06c1358a6cb1f67420c9133ac0299ce97`
  (`git log -1`: `c09835e06c1358a6cb1f67420c9133ac0299ce97 2026-10-11 17:17:54 +0300 Masjid Pulse MVP: API, admin PWA, TV display, tests, CI, Android TV stub`)
- **How:** fresh `git clone` of that commit into `/tmp/mp-clean`, then `npm ci` and each script below.
  This file was added in a later commit, so the repository HEAD will be one commit after the one above.
- **Environment:** Node v20.19.2, npm 9.2.0, Linux 6.12.94+

## Summary (taken from the outputs below)

| Check                 | Command                                                             | Result                                                                                                                    |
| --------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Install               | `npm ci`                                                            | exit=0                                                                                                                    |
| Format                | `npm run format:check`                                              | exit=0                                                                                                                    |
| Lint                  | `npm run lint`                                                      | exit=0                                                                                                                    |
| Typecheck             | `npm run typecheck`                                                 | exit=0                                                                                                                    |
| Build                 | `npm run build`                                                     | exit=0                                                                                                                    |
| Tests + coverage      | `npm run test:coverage`                                             | 3 test files, 65 tests passed, 0 failed; exit=0                                                                           |
| Coverage (V8, `src/`) | `npm run test:coverage`                                             | Statements : 96.25% ( 693/720 ); Branches : 86.03% ( 308/358 ); Functions : 96.68% ( 146/151 ); Lines : 98.4% ( 618/628 ) |
| Dependency audit      | `npm audit --omit=dev --audit-level=high`                           | exit=0                                                                                                                    |
| Seed                  | `npx tsx src/scripts/seed.ts`                                       | exit=0                                                                                                                    |
| curl smoke test       | `BASE=http://localhost:3918 bash scripts/smoke.sh`                  | exit=0                                                                                                                    |
| Browser walkthrough   | `node scripts/browser-e2e.mjs` (headless Chrome, manual, not in CI) | exit=0                                                                                                                    |

Coverage is V8 coverage of server-side TypeScript under `src/` (including `src/shared/display.ts`, the
logic bundled into the TV app). `src/server.ts` is excluded. The browser JS in `public/admin/app.js` and
`public/tv/tv.js` is **not** covered by these numbers.

Not verified here: the GitHub Actions workflow has not been run on GitHub; the Android TV wrapper was not
built (no JDK/Android SDK on this machine).

## Test run with coverage (`npm run test:coverage`)

```
Test Files  3 passed (3)
      Tests  65 passed (65)
   Start at  17:18:12
   Duration  4.24s (tests 83%, import 8%, transform 8%, worker 1%)
```

```
% Coverage report from v8
----------------|---------|----------|---------|---------|---------------------
File            | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
----------------|---------|----------|---------|---------|---------------------
All files       |   96.25 |    86.03 |   96.68 |    98.4 |
 src            |    87.5 |    72.22 |    62.5 |   94.44 |
  app.ts        |   91.17 |    57.14 |   66.66 |   96.77 | 35
  config.ts     |   66.66 |    81.81 |      50 |      80 | 21
 src/db         |   94.73 |    83.33 |     100 |     100 |
  db.ts         |   94.44 |    83.33 |     100 |     100 | 10
 src/middleware |   93.84 |    86.84 |     100 |   96.29 |
  auth.ts       |   94.73 |     90.9 |     100 |     100 | 45-61
  errors.ts     |   92.59 |    81.25 |     100 |    91.3 | 41-42
 src/routes     |   97.45 |    82.73 |   98.36 |   99.64 |
  auth.ts       |     100 |    83.33 |     100 |     100 | 37-61
  content.ts    |    97.4 |    76.47 |   96.55 |   99.27 | 185
  context.ts    |     100 |       75 |     100 |     100 | 17
  manage.ts     |   95.91 |    89.36 |     100 |     100 | 100,152,182,206,223
 src/scripts    |   84.61 |       50 |     100 |   84.61 |
  seed.ts       |   84.61 |       50 |     100 |   84.61 | 90-97
 src/services   |    97.4 |    92.13 |   97.61 |    99.2 |
  pairing.ts    |   95.45 |     87.5 |     100 |     100 | 23-28,117
  prayers.ts    |   98.21 |    93.33 |   95.23 |   97.56 | 30
  snapshot.ts   |   97.56 |    91.66 |     100 |     100 | 22,154
 src/shared     |   99.01 |    98.14 |     100 |     100 |
  display.ts    |   99.01 |    98.14 |     100 |     100 | 152
----------------|---------|----------|---------|---------|---------------------

=============================== Coverage summary ===============================
Statements   : 96.25% ( 693/720 )
Branches     : 86.03% ( 308/358 )
Functions    : 96.68% ( 146/151 )
Lines        : 98.4% ( 618/628 )
================================================================================
exit=0
```

## Individual test results (`npx vitest run --reporter=verbose`)

```

 RUN  v5.0.3 /tmp/mp-clean

 ✓ tests/unit/display.test.ts > time & date helpers > validates HH:MM times 2ms
 ✓ tests/unit/display.test.ts > time & date helpers > validates calendar dates 1ms
 ✓ tests/unit/display.test.ts > time & date helpers > converts times and does date arithmetic across month/year ends 1ms
 ✓ tests/unit/display.test.ts > time & date helpers > computes local wall-clock time in a timezone 12ms
 ✓ tests/unit/display.test.ts > validateDay > accepts a valid day 0ms
 ✓ tests/unit/display.test.ts > validateDay > rejects iqamah before adhan 1ms
 ✓ tests/unit/display.test.ts > validateDay > rejects out-of-order prayers and malformed times 0ms
 ✓ tests/unit/display.test.ts > next prayer / iqamah countdown > before Fajr counts down to Fajr adhan 1ms
 ✓ tests/unit/display.test.ts > next prayer / iqamah countdown > between adhan and iqamah counts down to iqamah 0ms
 ✓ tests/unit/display.test.ts > next prayer / iqamah countdown > exactly at adhan switches to the iqamah countdown 0ms
 ✓ tests/unit/display.test.ts > next prayer / iqamah countdown > skips iqamah countdown when iqamah is not set 0ms
 ✓ tests/unit/display.test.ts > next prayer / iqamah countdown > after Isha iqamah rolls over to tomorrow Fajr 0ms
 ✓ tests/unit/display.test.ts > next prayer / iqamah countdown > returns null when the snapshot has no data for today or tomorrow 0ms
 ✓ tests/unit/display.test.ts > next prayer / iqamah countdown > highlights the current prayer 0ms
 ✓ tests/unit/display.test.ts > Jummah on Friday > replaces Dhuhr with Jumu'ah on Fridays only 0ms
 ✓ tests/unit/display.test.ts > Jummah on Friday > countdown uses Jummah iqamah on Friday 0ms
 ✓ tests/unit/display.test.ts > announcement expiry > is active inclusively between start and end date 0ms
 ✓ tests/unit/display.test.ts > announcement expiry > filters expired and future announcements 0ms
 ✓ tests/unit/display.test.ts > formatting & rotation > formats countdowns 0ms
 ✓ tests/unit/display.test.ts > formatting & rotation > formats last-updated age 1ms
 ✓ tests/unit/display.test.ts > formatting & rotation > builds rotation from active announcements then slides 0ms
 ✓ tests/unit/services.test.ts > migrations > are idempotent 6ms
 ✓ tests/unit/services.test.ts > pairing service > generates a 5-digit code with a 10 minute expiry 3ms
 ✓ tests/unit/services.test.ts > pairing service > rejects claims after expiry 2ms
 ✓ tests/unit/services.test.ts > pairing service > accepts a claim just before expiry and is one-time use 2ms
 ✓ tests/unit/services.test.ts > pairing service > requires the pairing secret to poll 2ms
 ✓ tests/unit/services.test.ts > pairing service > rejects malformed codes 1ms
 ✓ tests/unit/services.test.ts > prayer schedule service > carries the latest schedule forward to later dates 2ms
 ✓ tests/unit/services.test.ts > prayer schedule service > "today only" iqamah override applies to one date only 2ms
 ✓ tests/unit/services.test.ts > prayer schedule service > persistent iqamah update carries forward and replaces a same-day override 2ms
 ✓ tests/unit/services.test.ts > prayer schedule service > rejects invalid iqamah and missing schedules 2ms
 ✓ tests/unit/services.test.ts > snapshot service > publishes versioned snapshots atomically and tracks unpublished changes 17ms
 ✓ tests/unit/services.test.ts > snapshot service > emergency pause freezes the TV on the last approved snapshot and blocks publishing 4ms
 ✓ tests/unit/services.test.ts > audit log > is append-only (UPDATE and DELETE are rejected by the database) 2ms
 ✓ tests/unit/services.test.ts > seed script > creates a demo mosque with a published snapshot and is idempotent 82ms
 ✓ tests/api/api.test.ts > health & auth > health endpoint reports ok 32ms
 ✓ tests/api/api.test.ts > health & auth > registers, logs in, and returns memberships; passwords are hashed 177ms
 ✓ tests/api/api.test.ts > health & auth > rejects bad credentials, duplicate emails, weak passwords and bad timezones 153ms
 ✓ tests/api/api.test.ts > health & auth > requires a valid token for mosque routes 74ms
 ✓ tests/api/api.test.ts > health & auth > changes password 352ms
 ✓ tests/api/api.test.ts > main journey: register -> prayer times -> publish -> pair TV -> snapshot > works end to end, with change detection 122ms
 ✓ tests/api/api.test.ts > main journey: register -> prayer times -> publish -> pair TV -> snapshot > returns snapshot:null for a paired TV before the first publish 76ms
 ✓ tests/api/api.test.ts > main journey: register -> prayer times -> publish -> pair TV -> snapshot > rejects publishing with no prayer times 74ms
 ✓ tests/api/api.test.ts > pairing via API > expires codes after 10 minutes 82ms
 ✓ tests/api/api.test.ts > pairing via API > codes are one-time use, even across mosques 143ms
 ✓ tests/api/api.test.ts > pairing via API > polling requires the pairing secret and delivers the token only once 85ms
 ✓ tests/api/api.test.ts > pairing via API > revoked devices lose access 87ms
 ✓ tests/api/api.test.ts > tenant isolation > users cannot read or modify another mosque 156ms
 ✓ tests/api/api.test.ts > tenant isolation > resource ids from another mosque are not reachable through your own mosque path 158ms
 ✓ tests/api/api.test.ts > tenant isolation > a TV only ever receives its own mosque's snapshot 151ms
 ✓ tests/api/api.test.ts > role enforcement > editors can edit content and publish 219ms
 ✓ tests/api/api.test.ts > role enforcement > editors cannot manage devices, users, pause, settings or view audit 223ms
 ✓ tests/api/api.test.ts > role enforcement > admins can add editors but cannot grant admin/owner; owners can 292ms
 ✓ tests/api/api.test.ts > role enforcement > the last owner cannot be demoted or removed 71ms
 ✓ tests/api/api.test.ts > announcements > reports status and auto-expires from the TV snapshot 93ms
 ✓ tests/api/api.test.ts > announcements > validates date ranges and supports edit/delete 86ms
 ✓ tests/api/api.test.ts > prayer schedule API > validates input, lists carried-forward days and clears overrides 86ms
 ✓ tests/api/api.test.ts > jummah > CRUD and inclusion in snapshot 83ms
 ✓ tests/api/api.test.ts > slides > uploads images within the size limit and serves them 104ms
 ✓ tests/api/api.test.ts > slides > rejects oversize files, non-images and missing files 101ms
 ✓ tests/api/api.test.ts > emergency pause > blocks publish and keeps the TV on the last approved snapshot 94ms
 ✓ tests/api/api.test.ts > audit log & settings > records actions and exposes them read-only to admins 86ms
 ✓ tests/api/api.test.ts > audit log & settings > preview returns the unpublished draft payload 84ms
 ✓ tests/api/api.test.ts > audit log & settings > returns JSON 404 for unknown API routes and 400 for bad JSON 6ms
 ✓ tests/api/api.test.ts > static surfaces > serves admin, TV and public pages 10ms

 Test Files  3 passed (3)
      Tests  65 passed (65)
   Start at  17:18:45
   Duration  4.11s (tests 85%, import 8%, transform 7%)

exit=0
```

## Lint / typecheck / format / build

```

> masjid-pulse@0.1.0 format:check
> prettier --check .

Checking formatting...
All matched files use Prettier code style!
exit=0
```

```

> masjid-pulse@0.1.0 lint
> eslint .

exit=0
```

```

> masjid-pulse@0.1.0 typecheck
> tsc --noEmit -p tsconfig.json

exit=0
```

```

> masjid-pulse@0.1.0 build
> npm run build:web && tsc -p tsconfig.build.json


> masjid-pulse@0.1.0 build:web
> esbuild src/shared/display.ts --bundle --format=esm --target=es2019 --outfile=public/tv/display.js


  public/tv/display.js  5.5kb

⚡ Done in 3ms
exit=0
```

## Dependency audit

```
found 0 vulnerabilities
exit=0
```

## Smoke test: register → prayer times → publish → pair TV → fetch snapshot

Server started from the clean clone: `DATABASE_FILE=/tmp/mp-clean-data/db.sqlite PORT=3918 node dist/server.js`

```
Masjid Pulse listening on http://localhost:3918  (admin: /admin, TV: /tv)
```

```

== GET /api/health
{"status":"ok","db":"ok","time":"2026-10-11T14:18:27.950Z"}

== POST /api/auth/register
{"token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIyIiwiaWF0IjoxNzkxNzI4MzA4LCJleHAiOjE3OTQzMjAzMDh9.rdThBthZKSMvnrSL5I_qimrk_n6uFuMBOJJuD_-9GuU","user":{"id":2,"email":"smoke-1791728307-11804@example.com","name":"Smoke Tester"},"mosque":{"id":2,"name":"Smoke Test Masjid","role":"owner"}}

mosque id=2, mosque-local today=2026-10-11

== PUT /api/mosques/2/prayers/2026-10-11
{"ok":true,"effective":{"date":"2026-10-11","prayers":[{"key":"fajr","name":"Fajr","adhan":"04:50","iqamah":"05:10"},{"key":"dhuhr","name":"Dhuhr","adhan":"11:55","iqamah":"12:15"},{"key":"asr","name":"Asr","adhan":"15:15","iqamah":"15:30"},{"key":"maghrib","name":"Maghrib","adhan":"17:50","iqamah":

== PATCH quick iqamah (Isha, today only)
{"ok":true,"effective":{"date":"2026-10-11","prayers":[{"key":"fajr","name":"Fajr","adhan":"04:50","iqamah":"05:10"},{"key":"dhuhr","name":"Dhuhr","adhan":"11:55","iqamah":"12:15"},{"key":"asr","name"

== POST announcement
{"id":3,"title":"Smoke test","body":"Hello","startDate":"2026-10-11","endDate":"2026-10-11","createdAt":"2026-10-11T14:18:28.352Z","status":"active"}

== GET publish status (before)
{"paused":false,"draftRevision":4,"lastPublished":null,"hasUnpublishedChanges":true}

== POST /publish
{"version":1,"publishedAt":"2026-10-11T14:18:28.366Z","days":14}
status after publish: {"paused":false,"draftRevision":4,"lastPublished":{"version":1,"publishedAt":"2026-10-11T14:18:28.366Z"},"hasUnpublishedChanges":false}

== TV: POST /api/tv/pairing
{"pairingId":"30607f2e-927e-4810-b05a-5ddb46985066","pairingSecret":"DrPgooe1gJ5ML7zNKIinp3tyhxkkE1XV","code":"22154","expiresAt":"2026-10-11T14:28:28.449Z"}

== TV polls status (pending)
{"status":"pending","code":"22154","expiresAt":"2026-10-11T14:28:28.449Z"}

== Admin enters code 22154
{"deviceId":1,"name":"Main Hall TV"}

== Admin re-enters same code (must fail: one-time use)
HTTP 404

== TV polls status (paired, receives token once)
status=paired token=yp4aom…

== TV: GET /api/tv/snapshot
{"version":1,"mosque":"Smoke Test Masjid","today":{"date":"2026-10-11","prayers":[{"key":"fajr","name":"Fajr","adhan":"04:50","iqamah":"05:10"},{"key":"dhuhr","name":"Dhuhr","adhan":"11:55","iqamah":"12:15"},{"key":"asr","name":"Asr","adhan":"15:15","iqamah":"15:30"},{"key":"maghrib","name":"Maghrib","adhan":"17:50","iqamah":"17:55"},{"key":"isha","name":"Isha","adhan":"19:05","iqamah":"19:30","overridden":true}]},"announcements":1}

== TV: GET /api/tv/snapshot?version=1 (unchanged)
{"unchanged":true,"version":1,"paused":false}

== Admin: devices
[{"id":1,"name":"Main Hall TV","createdAt":"2026-10-11T14:18:28.713Z","lastSeenAt":"2026-10-11T14:18:29.059Z","snapshotVersion":1,"online":true,"upToDate":true}]

SMOKE OK
exit=0
```

## Browser walkthrough (headless Chrome via puppeteer-core)

Pairs a TV in one browser profile using the code it displays, logs into the admin as the seeded demo
user, opens every admin screen, then cuts the TV's network and reloads it to confirm it renders from
cache. The script ignores `net::ERR_INTERNET_DISCONNECTED` / "Failed to load resource" console errors
(expected while offline); any other page error or console error would be listed in `errors`.
Screenshots from this run are in `docs/screenshots/`.

```
TV code 65948
tv display shot
route prayers
route jummah
route announcements
route slides
route users
route audit
route settings
prayers shot
offline step
offline {"displayVisible":true,"conn":"● Offline — showing saved times","updated":"Last updated just now · v1 · last sync just now","rows":5}
errors []
exit=0
```

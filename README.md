<p align="center"><img src="assets/brand/masjid-pulse-logo-primary.png" alt="Masjid Pulse" width="420" /></p>

# Masjid Pulse (MVP)

A free prayer-time TV display system for mosques. **Core display system only** — no donations,
finance, education or community features.

> Install after Maghrib, connect before Isha, trust it before Fajr.

Surfaces (all served by one Node.js process):

| Surface                        | URL        | What it is                                                                                  |
| ------------------------------ | ---------- | ------------------------------------------------------------------------------------------- |
| Public website                 | `/`        | Landing page with register / login links                                                    |
| Web Admin + Mobile Admin (PWA) | `/admin/`  | Responsive SPA, installable (manifest + service worker)                                     |
| TV Display                     | `/tv/`     | Full-screen display for the prayer hall; also packaged as an Android TV app (`android-tv/`) |
| API                            | `/api/...` | REST/JSON, health at `/api/health`                                                          |

## Quick start

Requires **Node.js 20+** (tested on 20.19). No paid services; SQLite file database.

```bash
npm install
npm run build          # compiles server to dist/ and bundles the TV display logic
npm run seed           # optional: demo mosque, login demo@masjidpulse.local / demo-password-123
npm start              # http://localhost:3000  (admin: /admin/, TV: /tv/)
```

Development: `npm run dev` (tsx watch). Production: copy `.env.example` to `.env` (git-ignored), fill
it in, `npm run build && npm run start:env` (uses Node's `--env-file`). Environment variables:

| Var               | Default                    | Notes                                                                  |
| ----------------- | -------------------------- | ---------------------------------------------------------------------- |
| `PORT`            | `3000`                     |                                                                        |
| `APP_URL`         | `http://localhost:$PORT`   | public base URL used in email links                                    |
| `DATABASE_FILE`   | `data/masjid-pulse.db`     | SQLite file (WAL mode)                                                 |
| `UPLOAD_DIR`      | `data/uploads`             | slide images                                                           |
| `JWT_SECRET`      | dev-only value             | **required** when `NODE_ENV=production`; also signs email tokens       |
| `MAX_SLIDE_BYTES` | `2097152` (2 MB)           | slide upload limit                                                     |
| `TRUST_PROXY`     | off                        | `1` (hops) behind a reverse proxy so rate limits see real client IPs   |
| `HTTPS_REDIRECT`  | off                        | `1` = HTTP→HTTPS redirect for everything except the TV display paths   |
| `SMTP_HOST`       | —                          | e.g. `smtp.gmail.com`. Unset → emails are printed to the console       |
| `SMTP_PORT`       | `465`                      | 465 = implicit TLS, 587 = STARTTLS                                     |
| `SMTP_USER`       | —                          | e.g. `ahmed.gorse@gmail.com`                                           |
| `SMTP_PASS`       | —                          | Gmail **App Password** (16 chars). Only ever read from the environment |
| `MAIL_FROM`       | `Masjid Pulse <SMTP_USER>` | From header                                                            |
| `DEV_OUTBOX`      | off                        | `1` = expose `GET /api/dev/outbox` (dev mailer only, never production) |
| `SEED_TIMEZONE`   | `Europe/London`            | timezone of the seeded demo mosque                                     |

**Email setup (Gmail):** turn on 2-Step Verification for the Google account, create an App Password
(Google Account → Security → App passwords), then set `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`,
`SMTP_USER=ahmed.gorse@gmail.com`, `SMTP_PASS=<app password>` in the server's environment (or the
git-ignored `.env`). The password is never written to disk or git by Masjid Pulse; `/api/health`
reports `"mail":"smtp"` or `"mail":"dev"`.

**Production without email** (no `SMTP_HOST`, or `SMTP_USER` set without `SMTP_PASS`): the app logs a
warning, writes every email (with its link) to the server log instead, and marks new registrations as
verified immediately so publishing and TV pairing are not blocked. Password-reset and invitation links
can then be read from the log (e.g. `fly logs`). Set `SMTP_PASS` to switch to real email.

### First run (the main journey)

1. Open `/admin/#/register`, register the mosque (pick its IANA timezone, e.g. `Africa/Mogadishu`),
   then click the link in the confirmation email (publishing and pairing are locked until then).
2. **Prayer times**: set the mosque location (city search, _Use my location_, or lat/lon) + calculation
   method and iqamah rules → _Use automatic times_. Adhan times are then computed every day; nobody has
   to edit times daily. (Manual entry is still available: times carry forward until changed.)
3. Open `/tv/` on the TV. It shows a **5-digit code** (valid 10 minutes, one-time use).
4. Admin → **Devices** → type the code → _Pair TV_.
5. **Today** → _Publish to TVs_. The TV picks it up within ~30 s.

## Quality checks

```bash
npm run lint           # ESLint (typescript-eslint + browser JS)
npm run typecheck      # tsc --noEmit (strict)
npm run format:check   # Prettier
npm test               # Vitest: unit + API integration (supertest, in-memory SQLite)
npm run test:coverage  # with V8 coverage (server-side src/ only)
BASE=http://localhost:3000 npm run smoke   # curl smoke test of the main journey against a running server
```

CI: `.github/workflows/ci.yml` runs format, lint, typecheck, build, tests with coverage, the curl smoke
test and `npm audit` on Node 20 and 22. (The workflow file is included; it has not been run on GitHub
from this machine.)

`scripts/browser-e2e.mjs` is an optional headless-Chrome walkthrough (pair TV in a browser, admin
screens, offline reload of the TV). It is not part of `npm test`; it was used to capture
`docs/screenshots/`.

## Architecture

```
src/
  server.ts              entry point (opens DB, starts Express)
  app.ts                 createApp(db, config): routes, static files, error handler
  config.ts              env config + injectable clock (used by tests)
  db/schema.ts, db.ts    SQL migrations (portable SQL + SQLite triggers), better-sqlite3
  shared/prayertimes.ts  PURE automatic prayer times (adhan-js) + iqamah rules + offline day extension
  shared/display.ts      PURE display logic shared by server and TV (bundled into public/tv/app.js):
                         time parsing/validation, next prayer + iqamah countdown, Friday Jumu'ah,
                         announcement activity, rotation, formatting, timezone "local now"
  services/              prayers (carry-forward + "today only" overrides), snapshot (atomic publish,
                         pause), pairing (codes, expiry, one-time use), audit (append-only), crypto
  middleware/            auth (JWT users, device tokens, mosque-scoped role checks), errors
  routes/                auth, content (mosque settings, prayers, iqamah, jummah, announcements,
                         slides), manage (today, publish, pause, devices, users, audit), tv
  scripts/seed.ts        demo mosque
  tv/tv.js               TV display app (browser JS; built to public/tv/app.js as ES5, see below)
public/
  index.html             public website
  admin/                 SPA (index.html, app.js, styles.css, manifest.webmanifest, sw.js)
  tv/                    TV app (index.html, tv.css, sw.js; app.js is generated from src/tv/tv.js)
  brand/, icons/         logo, emblem, PWA icons, Android TV banner (generated from the logo)
assets/brand/            original logo files (primary + alternates)
tests/unit, tests/api    Vitest suites
android-tv/              Android TV app (Kotlin, bundled TV web app, Gradle wrapper) — see its README
```

### Domain rules implemented

- **Entities / tables**: users, mosques, mosque_users (owner/admin/editor), prayer_schedules (per-date
  rows, carried forward), prayer_overrides ("today only"), jummah_schedules, announcements (start/end
  date, soft delete), slides (PNG/JPEG/WebP, size limit, soft delete), devices (hashed tokens),
  pairing_codes, display_snapshots, audit_logs.
- **Tenant isolation**: every mosque route is `/api/mosques/:mosqueId/...`; middleware checks
  membership and every query filters by `mosque_id`. Devices only ever read their own mosque's snapshot.
- **Roles (server-side)**: editor = content + publish; admin = + devices, users (editors only), pause,
  settings, audit; owner = everything incl. granting admin/owner. The last owner can't be removed.
- **Publish**: a `DisplaySnapshot` (14 days of effective prayer times, Jummah, non-expired
  announcements, active slides) is built and inserted inside one `BEGIN IMMEDIATE` transaction with a
  per-mosque version. TVs render **only** published snapshots; drafts are invisible until Publish.
  Today screen shows "unpublished changes" via a draft revision counter.
- **Automatic prayer times** (`adhan` npm package, adhan-js): per-mosque latitude/longitude, IANA
  timezone, method (MWL, ISNA, Egyptian, Umm al-Qura, Karachi, Dubai, Qatar, Kuwait, Singapore, Turkey,
  Tehran, North America, Moonsighting Committee — adhan-js implements ISNA as "North America", so those
  two are identical), Asr madhab (Shafi/Hanafi), high-latitude rule (automatic = adhan-js
  recommendation, middle of the night, 1/7 of the night, twilight angle); inside the polar circle the
  closest computable day is used. **Iqamah rules** per prayer: N minutes after adhan, fixed clock time,
  or none; optional rounding (5/10/15/30 min, up or nearest); never before the adhan (a fixed time
  earlier than the adhan becomes adhan + 10 min). Defaults: Fajr +20, Dhuhr/Asr/Isha +15 (rounded up to
  5), Maghrib +7. **Precedence**: "today only" override (adhan and/or iqamah) > rule/calculation; an
  overridden adhan re-applies the iqamah rule. Times after midnight (e.g. Isha at 01:27 in Fort
  McMurray in June with "middle of the night") carry a `+1 day` offset and the countdown handles them.
  A permanent quick-iqamah change in automatic mode becomes a fixed-time rule.
- **Daily refresh**: each snapshot embeds its approved inputs (calculation settings, rules, published
  overrides). When fewer than 7 days remain, the server rolls the window forward (hourly job + on demand
  when a TV polls) using only that published data — unpublished drafts never leak. The TV itself also
  computes missing days locally from the embedded settings, so it stays correct offline indefinitely.
- **Email**: verification on registration (48 h link), password reset (1 h, newest link only, signs out
  all sessions), invitations (7 days; new people choose their own password, existing accounts are
  added and notified). Tokens are HMAC-signed (`JWT_SECRET`), expiring and single-use (only a SHA-256
  of each token is stored; consumption is an atomic `UPDATE … WHERE used_at IS NULL`). Forgot-password
  never reveals whether an account exists. Changing the password also invalidates other sessions.
- **Rate limiting** (per client IP, `express-rate-limit`, `429` JSON): login 20/15 min, register
  10/h, forgot/reset/verify 5/15 min, pairing code creation 30/15 min, pairing status polling 600/15
  min (TVs poll every 3 s), pairing claim 10/15 min.
- **Emergency pause**: blocks publishing and pins TVs to the snapshot that was current when paused.
- **Pairing**: TV gets a random 5-digit code (unique among live codes) + a secret; 10-minute expiry;
  one-time use; the device token is delivered once to the TV (then wiped) and stored only as SHA-256.
  Revoking a device makes the TV forget its token and cache and return to pairing.
- **Announcements** auto-expire: excluded from new snapshots after `endDate` (mosque-local date), and
  the TV filters by date again while offline.
- **Audit log** is append-only, enforced by DB triggers that abort UPDATE/DELETE.
- **TV offline**: snapshot cached in `localStorage`; app shell + slide images cached by a service
  worker; status bar shows Online/Offline and "Last updated … · vN". Polls every 30 s with
  `?version=N` (returns `{unchanged:true}` when nothing changed).

## Deployment (Docker, Fly.io)

The app is one Node process with a SQLite file and an uploads folder, so it needs **one always-on
container with a persistent disk** mounted at `/data` (serverless hosts such as Vercel/Netlify have no
persistent disk). The `Dockerfile` builds everything; the image defaults to `PORT=8080`,
`DATABASE_FILE=/data/masjid-pulse.db`, `UPLOAD_DIR=/data/uploads`, `TRUST_PROXY=1`.

```bash
docker build -t masjid-pulse .
docker run -p 8080:8080 -v masjid-data:/data -e JWT_SECRET=$(openssl rand -hex 32) \
  -e APP_URL=http://localhost:8080 masjid-pulse
```

**Fly.io** (`fly.toml` included; about US$2.50/month for a 256 MB machine + 1 GB volume, card required):

```bash
fly auth signup                      # or: fly auth login
fly launch --copy-config --no-deploy # choose a unique app name + region; keeps fly.toml
fly volumes create masjid_data --size 1 --region <region>
fly secrets set JWT_SECRET=$(openssl rand -hex 32) APP_URL=https://<app>.fly.dev \
  SMTP_HOST=smtp.gmail.com SMTP_PORT=465 SMTP_USER=... SMTP_PASS=...
fly deploy
```

Admin: `https://<app>.fly.dev/admin/`, TV: `https://<app>.fly.dev/tv/`. Back up with
`fly ssh sftp get /data/masjid-pulse.db` (Fly also keeps daily volume snapshots for 5 days).

**Old Smart TVs and HTTPS**: LG webOS 3-5 TVs no longer receive root-certificate updates and may
reject current certificate chains (Let's Encrypt now chains to ISRG Root X1/X2). If the TV shows a
certificate error, open `http://<host>/tv/` instead: `fly.toml` sets `HTTPS_REDIRECT=1` with
`force_https = false`, so only the TV display, its API and images are served over plain HTTP while
the admin is redirected to HTTPS. Note `.dev` and `.app` domains are HSTS-preloaded in browsers
from 2017 on, so plain HTTP only helps older TVs (or use a custom `.com`/`.org` domain).

### TV browser compatibility

The TV page is a classic ES5 script (`public/tv/app.js`) built by `scripts/build-tv.mjs`: esbuild
bundles `src/tv/tv.js` + `src/shared`, Babel lowers it for Chromium 38 (LG webOS 3.x; webOS 4.x is
Chromium 53) with core-js and `fetch` polyfills, and `tv.css` uses no CSS variables, `gap` or grid.
`tests/unit/tv-bundle.test.ts` checks the bundle parses as ES5 and runs it in a sandbox with modern
built-ins removed. Offline restart needs a service worker (Chromium 40+), so on webOS 3.x the TV
keeps showing cached times while running but a reload without internet will fail.

## Known limitations / not done

- Rate limits are in-memory per process (fine for one server; use a shared store if you scale out).
- Email delivery through real Gmail SMTP was not exercised from this machine (no credentials here);
  it is covered with a fake transport in tests.
- Manually entered times must be same-day and ascending (after-midnight Isha is supported for
  automatic times only). City search uses OpenStreetMap Nominatim from the browser (optional).
- SQLite only (schema is plain SQL designed to port to Postgres, but no Postgres adapter exists yet).
- Slides are stored on local disk (no object storage). Image compression is client-side best effort.
- Admin SPA and TV UI have no automated browser tests in `npm test`; their pure logic
  (`src/shared/display.ts`) is unit-tested and a manual headless-Chrome script exists.

## Brand

Primary logo: `assets/brand/masjid-pulse-logo-primary.png`. Primary colours sampled from it:
deep green `#01534A`, red `#FD2D25`, TV black `#161D20`, off-white `#FEFEF7`. Earlier logo versions
and the stationery mockup (secondary layout inspiration) are in `assets/brand/alternates/`.

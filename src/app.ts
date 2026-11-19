import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DB } from './db/db.js';
import { type AppConfig, loadConfig } from './config.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { requireUser } from './middleware/auth.js';
import { authRouter } from './routes/auth.js';
import { contentRouter } from './routes/content.js';
import { manageRouter } from './routes/manage.js';
import { tvRouter } from './routes/tv.js';
import { prayerSettingsRouter } from './routes/prayerSettings.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// Works from both src/ (tsx, tests) and dist/ (compiled).
export const PUBLIC_DIR = path.resolve(here, '..', 'public');

/** Paths the TV display needs; still served over plain HTTP when HTTPS_REDIRECT is on. */
const TV_HTTP_ALLOWED = /^\/(tv(\/|$)|api\/tv(\/|$)|api\/health$|brand\/|icons\/|uploads\/)/;

export function createApp(db: DB, configOverrides: Partial<AppConfig> = {}) {
  const config = loadConfig(configOverrides);
  const ctx = { db, config };
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  if (config.httpsRedirect) {
    app.use((req, res, next) => {
      if (req.secure || TV_HTTP_ALLOWED.test(req.path)) return next();
      if (req.method !== 'GET' && req.method !== 'HEAD')
        return void res.status(403).json({ error: 'HTTPS required' });
      res.redirect(308, `https://${req.get('host')}${req.originalUrl}`);
    });
  }
  app.use(express.json({ limit: '200kb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  app.get('/api/health', (_req, res) => {
    let dbOk: boolean;
    try {
      dbOk = (db.prepare('SELECT 1 AS ok').get() as { ok: number }).ok === 1;
    } catch {
      dbOk = false;
    }
    res.status(dbOk ? 200 : 503).json({
      status: dbOk ? 'ok' : 'degraded',
      db: dbOk ? 'ok' : 'error',
      time: config.now().toISOString(),
      mail: config.mailer.mode,
    });
  });

  if (config.devOutboxApi) {
    // DEV ONLY (DEV_OUTBOX=1, no SMTP, not production): read emails "sent" by the dev mailer, so local
    // testing / the smoke test can follow verification and reset links.
    app.get('/api/dev/outbox', (_req, res) => res.json(config.mailer.outbox));
  }

  app.use('/api', authRouter(ctx));
  // The Android TV app loads the TV page from its bundled assets (a different origin), so the
  // device API allows cross-origin calls. It uses header tokens only (no cookies).
  app.use('/api/tv', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, X-Pairing-Secret, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
    if (req.method === 'OPTIONS') return void res.sendStatus(204);
    next();
  });
  app.use('/api/tv', tvRouter(ctx));
  const mosque = express.Router({ mergeParams: true });
  mosque.use(requireUser(db, config));
  mosque.use(prayerSettingsRouter(ctx));
  mosque.use(contentRouter(ctx));
  mosque.use(manageRouter(ctx));
  app.use('/api/mosques/:mosqueId', mosque);
  app.use('/api', (_req, _res, next) => next(notFound('API route not found')));

  app.use('/uploads', express.static(config.uploadDir, { maxAge: '7d', immutable: true }));
  app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));
  app.get(['/admin', '/admin/'], (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin', 'index.html')));
  app.get(['/tv', '/tv/'], (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'tv', 'index.html')));

  app.use(errorHandler);
  return app;
}

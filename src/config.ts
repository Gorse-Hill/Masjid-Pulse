import path from 'node:path';
import { type Mailer, createMailer } from './services/mailer.js';

export interface RateLimit {
  windowMs: number;
  max: number;
}
export interface RateLimits {
  login: RateLimit;
  register: RateLimit;
  passwordReset: RateLimit;
  pairingCreate: RateLimit;
  pairingPoll: RateLimit;
  pairingClaim: RateLimit;
}

/** Per client IP. TVs poll pairing status every 3 s, hence the higher poll limit. */
export const DEFAULT_RATE_LIMITS: RateLimits = {
  login: { windowMs: 15 * 60_000, max: 20 },
  register: { windowMs: 60 * 60_000, max: 10 },
  passwordReset: { windowMs: 15 * 60_000, max: 5 },
  pairingCreate: { windowMs: 15 * 60_000, max: 30 },
  pairingPoll: { windowMs: 15 * 60_000, max: 600 },
  pairingClaim: { windowMs: 15 * 60_000, max: 10 },
};

export interface AppConfig {
  jwtSecret: string;
  uploadDir: string;
  maxSlideBytes: number;
  pairingTtlMs: number;
  /** Public base URL used in email links, e.g. https://pulse.example.org */
  appUrl: string;
  mailer: Mailer;
  /** Expose GET /api/dev/outbox (dev mailer only, never in production). */
  devOutboxApi: boolean;
  rateLimits: RateLimits;
  /** Express "trust proxy" setting (TRUST_PROXY env), needed for per-IP limits behind a proxy. */
  trustProxy: boolean | number | string;
  /**
   * HTTPS_REDIRECT=1: redirect plain-HTTP requests to HTTPS (needs TRUST_PROXY behind a TLS proxy),
   * EXCEPT the TV display and its API/assets. Old Smart TVs (e.g. LG webOS 3-4) may not trust
   * today's certificate roots, so they can still be pointed at http://host/tv/ while the admin
   * (passwords) stays HTTPS-only.
   */
  httpsRedirect: boolean;
  /**
   * Production without working email (no SMTP, or SMTP_PASS missing): new registrations are marked
   * verified immediately, because the confirmation email cannot arrive. A warning is logged.
   */
  autoVerifyEmail: boolean;
  /** Injectable clock for tests. */
  now: () => Date;
}

function parseTrustProxy(v: string | undefined): boolean | number | string {
  if (!v) return false;
  if (v === 'true') return true;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const isProd = process.env.NODE_ENV === 'production';
  const jwtSecret = process.env.JWT_SECRET ?? (isProd ? '' : 'dev-only-insecure-secret-change-me');
  if (!jwtSecret) throw new Error('JWT_SECRET must be set in production');
  const mailer = overrides.mailer ?? createMailer(process.env);
  return {
    jwtSecret,
    uploadDir: process.env.UPLOAD_DIR ?? path.resolve('data/uploads'),
    maxSlideBytes: Number(process.env.MAX_SLIDE_BYTES ?? 2 * 1024 * 1024),
    pairingTtlMs: 10 * 60 * 1000,
    appUrl: (process.env.APP_URL ?? `http://localhost:${process.env.PORT ?? 3000}`).replace(/\/+$/, ''),
    mailer,
    devOutboxApi: !isProd && mailer.mode === 'dev' && process.env.DEV_OUTBOX === '1',
    rateLimits: DEFAULT_RATE_LIMITS,
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
    httpsRedirect: process.env.HTTPS_REDIRECT === '1',
    autoVerifyEmail: isProd && mailer.mode === 'dev',
    now: () => new Date(),
    ...overrides,
  };
}

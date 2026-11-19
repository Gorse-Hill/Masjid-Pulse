import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { openDatabase, type DB } from '../src/db/db.js';
import { type Mailer, createMailer } from '../src/services/mailer.js';
import { DEFAULT_RATE_LIMITS, type RateLimits } from '../src/config.js';

/** Generous limits so ordinary tests are not throttled; rate limiting has dedicated tests. */
export const RELAXED_LIMITS: RateLimits = Object.fromEntries(
  Object.entries(DEFAULT_RATE_LIMITS).map(([k, v]) => [k, { ...v, max: 10_000 }]),
) as unknown as RateLimits;

export interface TestEnv {
  db: DB;
  app: ReturnType<typeof createApp>;
  clock: { now: Date; advance(ms: number): void; set(iso: string): void };
  uploadDir: string;
  mailer: Mailer;
}

export function makeEnv(
  startIso = '2026-10-11T09:00:00.000Z',
  maxSlideBytes = 50_000,
  extra: { rateLimits?: RateLimits; mailer?: Mailer } = {},
): TestEnv {
  const db = openDatabase(':memory:');
  const clock = {
    now: new Date(startIso),
    advance(ms: number) {
      this.now = new Date(this.now.getTime() + ms);
    },
    set(iso: string) {
      this.now = new Date(iso);
    },
  };
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-uploads-'));
  const mailer = extra.mailer ?? createMailer({}, { quiet: true });
  const app = createApp(db, {
    now: () => clock.now,
    uploadDir,
    maxSlideBytes,
    jwtSecret: 'test-secret',
    mailer,
    appUrl: 'http://pulse.test',
    devOutboxApi: false, // independent of DEV_OUTBOX in the caller's environment
    rateLimits: extra.rateLimits ?? RELAXED_LIMITS,
  });
  return { db, app, clock, uploadDir, mailer };
}

/** Extract the token from the newest email to `to` (dev outbox). */
export function tokenFromLastEmail(env: TestEnv, to: string): string {
  const msg = [...env.mailer.outbox].reverse().find((m) => m.to === to);
  if (!msg) throw new Error('no email to ' + to);
  const m = /token=([^\s&"]+)/.exec(msg.text);
  if (!m) throw new Error('no token in email');
  return decodeURIComponent(m[1]);
}

export const DAY = {
  fajr: { adhan: '05:00', iqamah: '05:30' },
  dhuhr: { adhan: '12:30', iqamah: '13:00' },
  asr: { adhan: '15:45', iqamah: '16:00' },
  maghrib: { adhan: '18:05', iqamah: '18:10' },
  isha: { adhan: '19:30', iqamah: '19:45' },
};

let counter = 0;
export async function registerMosque(
  env: TestEnv,
  opts: { timezone?: string; mosqueName?: string; verify?: boolean } = {},
) {
  counter++;
  const email = `owner${counter}-${Date.now()}@example.com`;
  const res = await request(env.app)
    .post('/api/auth/register')
    .send({
      name: 'Owner ' + counter,
      email,
      password: 'password123',
      mosqueName: opts.mosqueName ?? `Mosque ${counter}`,
      city: 'Testville',
      timezone: opts.timezone ?? 'UTC',
    });
  if (res.status !== 201) throw new Error('register failed: ' + JSON.stringify(res.body));
  if (opts.verify !== false) {
    await request(env.app)
      .post('/api/auth/verify-email')
      .send({ token: tokenFromLastEmail(env, email) })
      .expect(200);
  }
  return {
    token: res.body.token as string,
    mosqueId: res.body.mosque.id as number,
    email,
    userId: res.body.user.id as number,
  };
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Unpaired TV requests a code; admin claims it; TV polls and receives its device token. */
export async function pairTv(env: TestEnv, token: string, mosqueId: number) {
  const p = await request(env.app).post('/api/tv/pairing');
  await request(env.app)
    .post(`/api/mosques/${mosqueId}/devices/pair`)
    .set(auth(token))
    .send({ code: p.body.code, name: 'Hall TV' })
    .expect(201);
  const s = await request(env.app)
    .get(`/api/tv/pairing/${p.body.pairingId}`)
    .set('X-Pairing-Secret', p.body.pairingSecret);
  return s.body.deviceToken as string;
}

/** Invite a new person by email and accept the invitation; returns their session token. */
export async function inviteAndAccept(
  env: TestEnv,
  inviterToken: string,
  mosqueId: number,
  email: string,
  role: 'owner' | 'admin' | 'editor',
  password = 'password123',
): Promise<{ token: string; userId: number }> {
  await request(env.app)
    .post(`/api/mosques/${mosqueId}/users`)
    .set('Authorization', `Bearer ${inviterToken}`)
    .send({ email, name: email.split('@')[0], role })
    .expect(201);
  const res = await request(env.app)
    .post('/api/auth/accept-invite')
    .send({ token: tokenFromLastEmail(env, email), password })
    .expect(201);
  return { token: res.body.token, userId: res.body.user.id };
}

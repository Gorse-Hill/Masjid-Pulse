import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  DAY,
  RELAXED_LIMITS,
  type TestEnv,
  auth,
  makeEnv,
  registerMosque,
  tokenFromLastEmail,
} from '../helpers.js';
import { type MailMessage, createMailer, smtpOptionsFromEnv } from '../../src/services/mailer.js';
import { DEFAULT_RATE_LIMITS, loadConfig } from '../../src/config.js';
import { createApp } from '../../src/app.js';
import { openDatabase } from '../../src/db/db.js';

let env: TestEnv;
beforeEach(() => {
  env = makeEnv();
});

const HOUR = 3600_000;

describe('email verification', () => {
  it('sends a verification email; unverified users cannot publish or pair until verified', async () => {
    const o = await registerMosque(env, { verify: false });
    const mail = env.mailer.outbox.at(-1)!;
    expect(mail).toMatchObject({ to: o.email, subject: 'Confirm your email for Masjid Pulse' });
    expect(mail.text).toContain('http://pulse.test/admin/#/verify?token=');
    expect(mail.html).toContain('Confirm email');
    const m = `/api/mosques/${o.mosqueId}`;
    expect((await request(env.app).get('/api/me').set(auth(o.token))).body.user.emailVerified).toBe(false);
    await request(env.app).put(`${m}/prayers/2026-10-11`).set(auth(o.token)).send(DAY).expect(200);
    const blocked = await request(env.app).post(`${m}/publish`).set(auth(o.token)).expect(403);
    expect(blocked.body.error).toMatch(/verify your email/);
    await request(env.app).post(`${m}/devices/pair`).set(auth(o.token)).send({ code: '12345' }).expect(403);

    const token = tokenFromLastEmail(env, o.email);
    await request(env.app).post('/api/auth/verify-email').send({ token }).expect(200);
    expect((await request(env.app).get('/api/me').set(auth(o.token))).body.user.emailVerified).toBe(true);
    await request(env.app).post(`${m}/publish`).set(auth(o.token)).expect(201);
    // single use
    await request(env.app).post('/api/auth/verify-email').send({ token }).expect(400);
  });

  it('rejects expired, tampered and wrong-purpose tokens', async () => {
    const o = await registerMosque(env, { verify: false });
    const token = tokenFromLastEmail(env, o.email);
    const [payload, sig] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), exp: Date.now() * 2 }),
    ).toString('base64url');
    await request(env.app)
      .post('/api/auth/verify-email')
      .send({ token: `${forged}.${sig}` })
      .expect(400);
    await request(env.app)
      .post('/api/auth/verify-email')
      .send({ token: `${payload}.${'A'.repeat(sig.length)}` })
      .expect(400);
    await request(env.app).post('/api/auth/verify-email').send({ token: 'not-a-token-at-all' }).expect(400);
    await request(env.app)
      .post('/api/auth/reset-password')
      .send({ token, password: 'newpassword1' })
      .expect(400);
    env.clock.advance(49 * HOUR);
    await request(env.app).post('/api/auth/verify-email').send({ token }).expect(400);
  });

  it('resend issues a new link and revokes the old one', async () => {
    const o = await registerMosque(env, { verify: false });
    const first = tokenFromLastEmail(env, o.email);
    const r = await request(env.app).post('/api/auth/resend-verification').set(auth(o.token)).expect(200);
    expect(r.body.emailSent).toBe(true);
    const second = tokenFromLastEmail(env, o.email);
    expect(second).not.toBe(first);
    await request(env.app).post('/api/auth/verify-email').send({ token: first }).expect(400);
    await request(env.app).post('/api/auth/verify-email').send({ token: second }).expect(200);
    const again = await request(env.app).post('/api/auth/resend-verification').set(auth(o.token)).expect(200);
    expect(again.body.alreadyVerified).toBe(true);
  });
});

describe('password reset', () => {
  it('does not reveal whether an account exists', async () => {
    const before = env.mailer.outbox.length;
    await request(env.app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@example.com' })
      .expect(200);
    expect(env.mailer.outbox.length).toBe(before);
  });

  it('resets the password with a single-use link, signs out old sessions, newest link only', async () => {
    const o = await registerMosque(env);
    await request(env.app)
      .post('/api/auth/forgot-password')
      .send({ email: o.email.toUpperCase() })
      .expect(200);
    const older = tokenFromLastEmail(env, o.email);
    await request(env.app).post('/api/auth/forgot-password').send({ email: o.email }).expect(200);
    const mail = env.mailer.outbox.at(-1)!;
    expect(mail.subject).toBe('Reset your Masjid Pulse password');
    expect(mail.text).toContain('http://pulse.test/admin/#/reset?token=');
    const token = tokenFromLastEmail(env, o.email);
    await request(env.app)
      .post('/api/auth/reset-password')
      .send({ token: older, password: 'brand-new-pass' })
      .expect(400);
    await request(env.app).post('/api/auth/reset-password').send({ token, password: 'short' }).expect(400);
    await request(env.app)
      .post('/api/auth/reset-password')
      .send({ token, password: 'brand-new-pass' })
      .expect(200);
    await request(env.app)
      .post('/api/auth/reset-password')
      .send({ token, password: 'another-pass-1' })
      .expect(400);
    await request(env.app).get('/api/me').set(auth(o.token)).expect(401); // old session invalidated
    await request(env.app)
      .post('/api/auth/login')
      .send({ email: o.email, password: 'password123' })
      .expect(401);
    const login = await request(env.app)
      .post('/api/auth/login')
      .send({ email: o.email, password: 'brand-new-pass' })
      .expect(200);
    await request(env.app).get('/api/me').set(auth(login.body.token)).expect(200);
  });

  it('reset links expire after 1 hour', async () => {
    const o = await registerMosque(env);
    await request(env.app).post('/api/auth/forgot-password').send({ email: o.email }).expect(200);
    const token = tokenFromLastEmail(env, o.email);
    env.clock.advance(HOUR + 1000);
    await request(env.app)
      .post('/api/auth/reset-password')
      .send({ token, password: 'brand-new-pass' })
      .expect(400);
  });

  it('changing the password returns a fresh session and invalidates the old one', async () => {
    const o = await registerMosque(env);
    const r = await request(env.app)
      .post('/api/me/password')
      .set(auth(o.token))
      .send({ currentPassword: 'password123', newPassword: 'changed-pass-1' })
      .expect(200);
    await request(env.app).get('/api/me').set(auth(o.token)).expect(401);
    await request(env.app).get('/api/me').set(auth(r.body.token)).expect(200);
  });
});

describe('invitations', () => {
  it('invites a new person by email; accepting creates a verified account with the role', async () => {
    const o = await registerMosque(env, { mosqueName: 'Al-Noor' });
    const m = `/api/mosques/${o.mosqueId}`;
    const inv = await request(env.app)
      .post(`${m}/users`)
      .set(auth(o.token))
      .send({ email: 'New@Example.com', name: 'Newbie', role: 'editor' })
      .expect(201);
    expect(inv.body).toMatchObject({ status: 'invited', email: 'new@example.com', emailSent: true });
    const mail = env.mailer.outbox.at(-1)!;
    expect(mail.subject).toContain('Al-Noor');
    expect(mail.text).toContain('/admin/#/accept-invite?token=');
    const pending = await request(env.app).get(`${m}/invites`).set(auth(o.token)).expect(200);
    expect(pending.body).toHaveLength(1);

    const token = tokenFromLastEmail(env, 'new@example.com');
    const peek = await request(env.app).get('/api/auth/invite').query({ token }).expect(200);
    expect(peek.body).toMatchObject({
      email: 'new@example.com',
      role: 'editor',
      mosque: 'Al-Noor',
      hasAccount: false,
    });
    await request(env.app).post('/api/auth/accept-invite').send({ token }).expect(400); // password required
    const acc = await request(env.app)
      .post('/api/auth/accept-invite')
      .send({ token, password: 'password123' })
      .expect(201);
    expect(acc.body.user).toMatchObject({ email: 'new@example.com', name: 'Newbie', emailVerified: true });
    await request(env.app)
      .post('/api/auth/accept-invite')
      .send({ token, password: 'password123' })
      .expect(400);
    await request(env.app).get('/api/auth/invite').query({ token }).expect(400);
    const users = await request(env.app).get(`${m}/users`).set(auth(o.token)).expect(200);
    expect(users.body.map((u: { email: string; role: string }) => [u.email, u.role])).toContainEqual([
      'new@example.com',
      'editor',
    ]);
    expect((await request(env.app).get(`${m}/invites`).set(auth(o.token))).body).toHaveLength(0);
    await request(env.app).put(`${m}/prayers/2026-10-11`).set(auth(acc.body.token)).send(DAY).expect(200);
    await request(env.app).post(`${m}/publish`).set(auth(acc.body.token)).expect(201);
  });

  it('existing accounts are added directly and notified; invites expire after 7 days', async () => {
    const a = await registerMosque(env);
    const b = await registerMosque(env, { mosqueName: 'Second' });
    const add = await request(env.app)
      .post(`/api/mosques/${b.mosqueId}/users`)
      .set(auth(b.token))
      .send({ email: a.email, role: 'admin' })
      .expect(201);
    expect(add.body).toMatchObject({ status: 'added' });
    expect(env.mailer.outbox.at(-1)).toMatchObject({
      to: a.email,
      subject: 'You were added to Second on Masjid Pulse',
    });
    await request(env.app)
      .post(`/api/mosques/${b.mosqueId}/users`)
      .set(auth(b.token))
      .send({ email: a.email, role: 'admin' })
      .expect(409);

    await request(env.app)
      .post(`/api/mosques/${a.mosqueId}/users`)
      .set(auth(a.token))
      .send({ email: 'late@example.com', name: 'Late', role: 'editor' })
      .expect(201);
    const token = tokenFromLastEmail(env, 'late@example.com');
    env.clock.advance(7 * 24 * HOUR + 1000);
    await request(env.app)
      .post('/api/auth/accept-invite')
      .send({ token, password: 'password123' })
      .expect(400);
  });

  it('an invite to someone who registered meanwhile just adds the membership', async () => {
    const a = await registerMosque(env);
    await request(env.app)
      .post(`/api/mosques/${a.mosqueId}/users`)
      .set(auth(a.token))
      .send({ email: 'later@example.com', name: 'Later', role: 'editor' })
      .expect(201);
    const token = tokenFromLastEmail(env, 'later@example.com');
    await request(env.app)
      .post('/api/auth/register')
      .send({
        name: 'L',
        email: 'later@example.com',
        password: 'password123',
        mosqueName: 'L',
        timezone: 'UTC',
      })
      .expect(201);
    const acc = await request(env.app).post('/api/auth/accept-invite').send({ token }).expect(201);
    const me = await request(env.app).get('/api/me').set(auth(acc.body.token)).expect(200);
    expect(me.body.mosques).toHaveLength(2);
    expect(me.body.user.emailVerified).toBe(true);
  });
});

describe('mailer (SMTP only from env, fake transport)', () => {
  it('derives Gmail SMTP options from env; nothing configured -> dev outbox', () => {
    expect(smtpOptionsFromEnv({})).toBeNull();
    const o = smtpOptionsFromEnv({
      SMTP_HOST: 'smtp.gmail.com',
      SMTP_PORT: '465',
      SMTP_USER: 'someone@gmail.com',
      SMTP_PASS: 'app-password-from-env',
    })!;
    expect(o).toMatchObject({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: 'someone@gmail.com' },
    });
    expect(smtpOptionsFromEnv({ SMTP_HOST: 'mail.example.org', SMTP_PORT: '587' })).toMatchObject({
      secure: false,
      requireTLS: true,
      auth: undefined,
    });
    expect(createMailer({}, { quiet: true }).mode).toBe('dev');
    expect(createMailer({ SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'u@gmail.com', SMTP_PASS: 'x' }).mode).toBe(
      'smtp',
    );
  });

  it('sends through the configured transport with MAIL_FROM', async () => {
    const sent: (MailMessage & { from: string })[] = [];
    const mailer = createMailer(
      { SMTP_HOST: 'smtp.gmail.com', MAIL_FROM: 'Masjid Pulse <pulse@example.org>' },
      { transport: { sendMail: async (m) => void sent.push(m) } },
    );
    const e = makeEnv(undefined, undefined, { mailer });
    await registerMosque(e, { verify: false });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      from: 'Masjid Pulse <pulse@example.org>',
      subject: 'Confirm your email for Masjid Pulse',
    });
    expect(mailer.outbox).toHaveLength(0);
  });

  it('an SMTP failure does not break registration', async () => {
    const mailer = createMailer(
      { SMTP_HOST: 'smtp.gmail.com' },
      {
        transport: {
          sendMail: async () => {
            throw new Error('535 auth failed');
          },
        },
      },
    );
    const e = makeEnv(undefined, undefined, { mailer });
    const res = await request(e.app)
      .post('/api/auth/register')
      .send({ name: 'A', email: 'a@example.com', password: 'password123', mosqueName: 'M', timezone: 'UTC' })
      .expect(201);
    expect(res.body.emailSent).toBe(false);
  });

  it('dev mailer logs to the console sink; the dev outbox API is opt-in', async () => {
    const lines: string[] = [];
    const m = createMailer({}, { log: (l) => lines.push(l) });
    await m.send({ to: 'x@example.com', subject: 'Hi', text: 'Body' });
    expect(lines[0]).toContain('[dev-mail] To: x@example.com | Subject: Hi');
    await request(env.app).get('/api/dev/outbox').expect(404);
    const app = createApp(openDatabase(':memory:'), { devOutboxApi: true, mailer: m });
    const out = await request(app).get('/api/dev/outbox').expect(200);
    expect(out.body[0]).toMatchObject({ to: 'x@example.com', subject: 'Hi' });
  });

  it('loadConfig only enables the dev outbox API with DEV_OUTBOX=1 outside production', () => {
    const old = { ...process.env };
    try {
      delete process.env.SMTP_HOST;
      process.env.DEV_OUTBOX = '1';
      process.env.TRUST_PROXY = '1';
      process.env.APP_URL = 'https://pulse.example.org/';
      const c = loadConfig();
      expect(c.devOutboxApi).toBe(true);
      expect(c.trustProxy).toBe(1);
      expect(c.appUrl).toBe('https://pulse.example.org');
      process.env.SMTP_HOST = 'smtp.gmail.com';
      expect(loadConfig().devOutboxApi).toBe(false);
    } finally {
      process.env = old;
    }
  });
});

describe('rate limiting', () => {
  const tight = (key: keyof typeof DEFAULT_RATE_LIMITS, max: number) =>
    makeEnv(undefined, undefined, { rateLimits: { ...RELAXED_LIMITS, [key]: { windowMs: 60_000, max } } });

  it('has sane production defaults', () => {
    expect(DEFAULT_RATE_LIMITS.login.max).toBeLessThanOrEqual(20);
    expect(DEFAULT_RATE_LIMITS.passwordReset.max).toBeLessThanOrEqual(5);
    expect(DEFAULT_RATE_LIMITS.pairingPoll.max).toBeGreaterThanOrEqual(300); // TV polls every 3 s
  });

  it('login', async () => {
    const e = tight('login', 3);
    for (let i = 0; i < 3; i++)
      await request(e.app)
        .post('/api/auth/login')
        .send({ email: 'a@example.com', password: 'x' })
        .expect(401);
    const res = await request(e.app)
      .post('/api/auth/login')
      .send({ email: 'a@example.com', password: 'x' })
      .expect(429);
    expect(res.body.error).toMatch(/Too many requests/);
    expect(res.headers['ratelimit-policy']).toBeTruthy();
  });

  it('register', async () => {
    const e = tight('register', 1);
    await registerMosque(e, { verify: false });
    await request(e.app).post('/api/auth/register').send({}).expect(429);
  });

  it('password reset', async () => {
    const e = tight('passwordReset', 2);
    await request(e.app).post('/api/auth/forgot-password').send({ email: 'a@example.com' }).expect(200);
    await request(e.app).post('/api/auth/forgot-password').send({ email: 'a@example.com' }).expect(200);
    await request(e.app).post('/api/auth/forgot-password').send({ email: 'a@example.com' }).expect(429);
  });

  it('pairing: code creation, status polling and claiming', async () => {
    const e1 = tight('pairingCreate', 1);
    await request(e1.app).post('/api/tv/pairing').expect(201);
    await request(e1.app).post('/api/tv/pairing').expect(429);

    const e2 = tight('pairingPoll', 1);
    const p = (await request(e2.app).post('/api/tv/pairing').expect(201)).body;
    await request(e2.app)
      .get(`/api/tv/pairing/${p.pairingId}`)
      .set('X-Pairing-Secret', p.pairingSecret)
      .expect(200);
    await request(e2.app)
      .get(`/api/tv/pairing/${p.pairingId}`)
      .set('X-Pairing-Secret', p.pairingSecret)
      .expect(429);

    const e3 = tight('pairingClaim', 2);
    const o = await registerMosque(e3);
    const m = `/api/mosques/${o.mosqueId}`;
    await request(e3.app).post(`${m}/devices/pair`).set(auth(o.token)).send({ code: '00000' }).expect(404);
    await request(e3.app).post(`${m}/devices/pair`).set(auth(o.token)).send({ code: '00000' }).expect(404);
    await request(e3.app).post(`${m}/devices/pair`).set(auth(o.token)).send({ code: '00000' }).expect(429);
  });
});

describe('production without SMTP_PASS (email not configured yet)', () => {
  it('SMTP user without password -> dev mailer (links go to the log) with a warning', () => {
    const lines: string[] = [];
    const m = createMailer(
      { SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: '465', SMTP_USER: 'u@gmail.com' },
      { log: (l) => lines.push(l) },
    );
    expect(m.mode).toBe('dev');
    expect(lines[0]).toContain('SMTP_PASS is missing');
  });

  it('loadConfig auto-verifies only in production with the dev mailer', () => {
    const old = { ...process.env };
    try {
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = 'x'.repeat(32);
      expect(loadConfig({ mailer: createMailer({}, { quiet: true }) }).autoVerifyEmail).toBe(true);
      expect(
        loadConfig({
          mailer: createMailer(
            { SMTP_HOST: 'h', SMTP_USER: 'u', SMTP_PASS: 'p' },
            { transport: { sendMail: async () => {} } },
          ),
        }).autoVerifyEmail,
      ).toBe(false);
      process.env.NODE_ENV = 'test';
      expect(loadConfig({ mailer: createMailer({}, { quiet: true }) }).autoVerifyEmail).toBe(false);
    } finally {
      process.env = old;
    }
  });

  it('registration is marked verified so publishing and pairing work', async () => {
    const db = openDatabase(':memory:');
    const app = createApp(db, {
      mailer: createMailer({}, { quiet: true }),
      autoVerifyEmail: true,
      jwtSecret: 'test-secret',
      devOutboxApi: false,
    });
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ name: 'A', email: 'a@example.com', password: 'password123', mosqueName: 'M', timezone: 'UTC' })
      .expect(201);
    expect(reg.body).toMatchObject({ emailVerified: true, emailSent: false, user: { emailVerified: true } });
    const me = await request(app).get('/api/me').set(auth(reg.body.token)).expect(200);
    expect(me.body.user.emailVerified).toBe(true);
  });
});

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { Ctx } from './context.js';
import { requireUser, signToken } from '../middleware/auth.js';
import { limiter } from '../middleware/rateLimit.js';
import { consumeToken, issueToken, revokeTokens } from '../services/tokens.js';
import { sendPasswordResetEmail, sendVerificationEmail } from '../services/emails.js';
import { HttpError, badRequest, conflict } from '../middleware/errors.js';
import { CALC_METHOD_KEYS, isValidTimezone } from '../shared/display.js';
import { logAudit } from '../services/audit.js';

const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
  mosqueName: z.string().trim().min(1).max(150),
  city: z.string().trim().max(100).optional(),
  timezone: z.string().refine(isValidTimezone, 'Unknown timezone'),
  // Optional: location for automatic prayer times.
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  method: z.enum(CALC_METHOD_KEYS).optional(),
});

const loginSchema = z.object({ email: z.string().trim().toLowerCase(), password: z.string() });

export function authRouter({ db, config }: Ctx): Router {
  const r = Router();
  const rl = config.rateLimits;
  const passwordSchema = z.string().min(8, 'Password must be at least 8 characters').max(200);
  const tokenVersion = (userId: number) =>
    (db.prepare('SELECT token_version FROM users WHERE id = ?').get(userId) as { token_version: number })
      .token_version;

  r.post('/auth/register', limiter('register', rl.register), async (req, res) => {
    const body = registerSchema.parse(req.body);
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(body.email)) {
      throw conflict('An account with this email already exists');
    }
    const hash = await bcrypt.hash(body.password, 10);
    const result = db.transaction(() => {
      const u = db
        .prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)')
        .run(body.email, hash, body.name);
      const userId = Number(u.lastInsertRowid);
      const m = db
        .prepare(
          'INSERT INTO mosques (name, city, timezone, latitude, longitude, calc_method, prayer_source) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          body.mosqueName,
          body.city ?? null,
          body.timezone,
          body.latitude ?? null,
          body.longitude ?? null,
          body.method ?? 'MWL',
          body.latitude !== undefined && body.longitude !== undefined ? 'calculated' : 'manual',
        );
      const mosqueId = Number(m.lastInsertRowid);
      db.prepare("INSERT INTO mosque_users (mosque_id, user_id, role) VALUES (?, ?, 'owner')").run(
        mosqueId,
        userId,
      );
      logAudit(db, { mosqueId, userId, action: 'mosque.register', entityType: 'mosque', entityId: mosqueId });
      return {
        userId,
        mosqueId,
        verifyToken: issueToken(db, config, { purpose: 'verify', email: body.email, userId }),
      };
    })();
    let emailSent = false;
    let emailVerified = false;
    if (config.autoVerifyEmail) {
      // No working email in production: the confirmation link could never arrive, so do not lock
      // publishing/pairing behind it.
      db.prepare('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?').run(
        config.now().toISOString(),
        result.userId,
      );
      emailVerified = true;
      console.warn(
        `[mail] WARNING: email is not configured; ${body.email} was marked verified without a confirmation email.`,
      );
    } else {
      emailSent = await sendVerificationEmail(config, body.email, body.name, result.verifyToken);
    }
    res.status(201).json({
      token: signToken(config, result.userId),
      user: { id: result.userId, email: body.email, name: body.name, emailVerified },
      emailSent,
      emailVerified,
      mosque: { id: result.mosqueId, name: body.mosqueName, role: 'owner' },
    });
  });

  r.post('/auth/login', limiter('login', rl.login), async (req, res) => {
    const body = loginSchema.parse(req.body);
    const user = db
      .prepare(
        'SELECT id, email, name, password_hash, email_verified_at, token_version FROM users WHERE email = ?',
      )
      .get(body.email) as
      | {
          id: number;
          email: string;
          name: string;
          password_hash: string;
          email_verified_at: string | null;
          token_version: number;
        }
      | undefined;
    // Always run a compare to reduce timing differences between unknown user / wrong password.
    const ok = await bcrypt.compare(
      body.password,
      user?.password_hash ?? '$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv',
    );
    if (!user || !ok) throw new HttpError(401, 'Invalid email or password');
    res.json({
      token: signToken(config, user.id, user.token_version),
      user: { id: user.id, email: user.email, name: user.name, emailVerified: !!user.email_verified_at },
    });
  });

  // ---- Email verification ----
  r.post('/auth/verify-email', limiter('verify', rl.passwordReset), (req, res) => {
    const { token } = z.object({ token: z.string().min(10).max(1000) }).parse(req.body);
    const email = db.transaction(() => {
      const t = consumeToken(db, config, token, 'verify');
      const u = db.prepare('SELECT id, email FROM users WHERE id = ?').get(t.user_id) as
        { id: number; email: string } | undefined;
      if (!u || u.email !== t.email)
        throw badRequest('This link is invalid or has expired. Please request a new one.');
      db.prepare('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?').run(
        config.now().toISOString(),
        u.id,
      );
      return u.email;
    })();
    res.json({ ok: true, email });
  });

  r.post(
    '/auth/resend-verification',
    requireUser(db, config),
    limiter('resend', rl.passwordReset),
    async (req, res) => {
      if (req.user!.emailVerified) return void res.json({ ok: true, alreadyVerified: true });
      revokeTokens(db, config, req.user!.id, 'verify');
      const token = issueToken(db, config, {
        purpose: 'verify',
        email: req.user!.email,
        userId: req.user!.id,
      });
      res.json({
        ok: true,
        emailSent: await sendVerificationEmail(config, req.user!.email, req.user!.name, token),
      });
    },
  );

  // ---- Password reset (responses never reveal whether an account exists) ----
  r.post('/auth/forgot-password', limiter('forgot', rl.passwordReset), async (req, res) => {
    const { email } = z.object({ email: z.string().trim().toLowerCase().pipe(z.email()) }).parse(req.body);
    const u = db.prepare('SELECT id, email FROM users WHERE email = ?').get(email) as
      { id: number; email: string } | undefined;
    if (u) {
      revokeTokens(db, config, u.id, 'reset'); // only the newest link works
      await sendPasswordResetEmail(
        config,
        u.email,
        issueToken(db, config, { purpose: 'reset', email: u.email, userId: u.id }),
      );
    }
    res.json({ ok: true });
  });

  r.post('/auth/reset-password', limiter('reset', rl.passwordReset), async (req, res) => {
    const body = z.object({ token: z.string().min(10).max(1000), password: passwordSchema }).parse(req.body);
    const hash = await bcrypt.hash(body.password, 10);
    db.transaction(() => {
      const t = consumeToken(db, config, body.token, 'reset');
      const u = db.prepare('SELECT id, email FROM users WHERE id = ?').get(t.user_id) as
        { id: number; email: string } | undefined;
      if (!u || u.email !== t.email)
        throw badRequest('This link is invalid or has expired. Please request a new one.');
      // New password, invalidate all existing sessions, and the email is proven to be theirs.
      db.prepare(
        `UPDATE users SET password_hash = ?, token_version = token_version + 1,
         email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?`,
      ).run(hash, config.now().toISOString(), u.id);
      revokeTokens(db, config, u.id, 'reset');
    })();
    res.json({ ok: true });
  });

  // ---- Invitations ----
  r.get('/auth/invite', (req, res) => {
    // Peek at an invite (for the accept form) without consuming it.
    const token = z.string().min(10).max(1000).parse(req.query.token);
    const [payload] = token.split('.');
    let id: string | undefined;
    try {
      id = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).id;
    } catch {
      /* invalid */
    }
    const row = db
      .prepare(
        `SELECT t.email, t.role, t.name, t.expires_at, t.used_at, m.name AS mosque,
         EXISTS(SELECT 1 FROM users u WHERE u.email = t.email) AS hasAccount
         FROM email_tokens t JOIN mosques m ON m.id = t.mosque_id WHERE t.id = ? AND t.purpose = 'invite'`,
      )
      .get(id ?? '') as
      | {
          email: string;
          role: string;
          name: string | null;
          expires_at: string;
          used_at: string | null;
          mosque: string;
          hasAccount: number;
        }
      | undefined;
    if (!row || row.used_at || row.expires_at <= config.now().toISOString())
      throw badRequest('This invitation is invalid or has expired. Ask your mosque admin for a new one.');
    res.json({
      email: row.email,
      role: row.role,
      name: row.name,
      mosque: row.mosque,
      hasAccount: !!row.hasAccount,
    });
  });

  r.post('/auth/accept-invite', limiter('invite', rl.register), async (req, res) => {
    const body = z
      .object({
        token: z.string().min(10).max(1000),
        name: z.string().trim().min(1).max(100).optional(),
        password: passwordSchema.optional(),
      })
      .parse(req.body);
    const hash = body.password ? await bcrypt.hash(body.password, 10) : null;
    const out = db.transaction(() => {
      const t = consumeToken(db, config, body.token, 'invite');
      let user = db.prepare('SELECT id, name FROM users WHERE email = ?').get(t.email) as
        { id: number; name: string } | undefined;
      if (!user) {
        if (!hash) throw badRequest('Choose a password (at least 8 characters)');
        const name = body.name ?? t.name;
        if (!name) throw badRequest('Name is required');
        const info = db
          .prepare('INSERT INTO users (email, password_hash, name, email_verified_at) VALUES (?, ?, ?, ?)')
          .run(t.email, hash, name, config.now().toISOString());
        user = { id: Number(info.lastInsertRowid), name };
      } else {
        // Existing account: the link proves the email; just add the membership.
        db.prepare('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?').run(
          config.now().toISOString(),
          user.id,
        );
      }
      const member = db
        .prepare('SELECT 1 FROM mosque_users WHERE mosque_id = ? AND user_id = ?')
        .get(t.mosque_id, user.id);
      if (!member) {
        db.prepare('INSERT INTO mosque_users (mosque_id, user_id, role) VALUES (?, ?, ?)').run(
          t.mosque_id,
          user.id,
          t.role,
        );
      }
      logAudit(db, {
        mosqueId: t.mosque_id!,
        userId: user.id,
        action: 'user.join',
        entityType: 'user',
        entityId: user.id,
        details: { email: t.email, role: t.role },
      });
      return { userId: user.id, mosqueId: t.mosque_id!, email: t.email, name: user.name, role: t.role };
    })();
    res.status(201).json({
      token: signToken(config, out.userId, tokenVersion(out.userId)),
      user: { id: out.userId, email: out.email, name: out.name, emailVerified: true },
      mosque: { id: out.mosqueId, role: out.role },
    });
  });

  r.get('/me', requireUser(db, config), (req, res) => {
    const mosques = db
      .prepare(
        `SELECT m.id, m.name, m.city, m.timezone, mu.role FROM mosque_users mu
         JOIN mosques m ON m.id = mu.mosque_id WHERE mu.user_id = ? ORDER BY m.id`,
      )
      .all(req.user!.id);
    res.json({ user: req.user, mosques });
  });

  r.post('/me/password', requireUser(db, config), limiter('password', rl.login), async (req, res) => {
    const body = z.object({ currentPassword: z.string(), newPassword: passwordSchema }).parse(req.body);
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user!.id) as {
      password_hash: string;
    };
    if (!(await bcrypt.compare(body.currentPassword, row.password_hash)))
      throw badRequest('Current password is wrong');
    // Changing the password signs out other sessions; this one gets a fresh token.
    db.prepare('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?').run(
      await bcrypt.hash(body.newPassword, 10),
      req.user!.id,
    );
    res.json({ ok: true, token: signToken(config, req.user!.id, tokenVersion(req.user!.id)) });
  });

  return r;
}

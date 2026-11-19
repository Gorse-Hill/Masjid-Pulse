import { Router } from 'express';
import { z } from 'zod';
import { type Ctx, intParam } from './context.js';
import { ROLE_RANK, type Role, requireMosqueRole, requireVerifiedEmail } from '../middleware/auth.js';
import { HttpError, badRequest, forbidden, notFound } from '../middleware/errors.js';
import { logAudit } from '../services/audit.js';
import {
  buildSnapshotPayload,
  getMosque,
  latestSnapshotRow,
  publishSnapshot,
  publishStatus,
  setPaused,
} from '../services/snapshot.js';
import { claimPairingCode } from '../services/pairing.js';
import { addDays, computeNextEvent, localNow } from '../shared/display.js';
import { getEffectiveDay } from '../services/prayers.js';
import { issueToken } from '../services/tokens.js';
import { sendAddedEmail, sendInviteEmail } from '../services/emails.js';
import { limiter } from '../middleware/rateLimit.js';

/** A device counts as online if it polled within this window. */
export const ONLINE_WINDOW_MS = 2 * 60 * 1000;

export function manageRouter({ db, config }: Ctx): Router {
  const r = Router({ mergeParams: true });
  const editor = requireMosqueRole(db, 'editor');
  const admin = requireMosqueRole(db, 'admin');

  const devicesFor = (mosqueId: number) => {
    const now = config.now().getTime();
    const latest = latestSnapshotRow(db, mosqueId)?.version ?? null;
    return (
      db
        .prepare(
          `SELECT id, name, created_at AS createdAt, last_seen_at AS lastSeenAt, last_snapshot_version AS snapshotVersion
           FROM devices WHERE mosque_id = ? AND revoked_at IS NULL ORDER BY id`,
        )
        .all(mosqueId) as { lastSeenAt: string | null; snapshotVersion: number | null }[]
    ).map((d) => ({
      ...d,
      online: !!d.lastSeenAt && now - new Date(d.lastSeenAt).getTime() < ONLINE_WINDOW_MS,
      upToDate: latest !== null && d.snapshotVersion === latest,
    }));
  };

  // ---- Today screen ----
  r.get('/today', editor, (req, res) => {
    const m = getMosque(db, req.mosqueId!);
    const now = localNow(m.timezone, config.now());
    const todayDay = getEffectiveDay(db, m.id, now.date);
    const days = [addDays(now.date, -1), now.date, addDays(now.date, 1)]
      .map((d) => (d === now.date ? todayDay : getEffectiveDay(db, m.id, d)))
      .filter((d) => d !== null);
    const jummah = buildSnapshotPayload(db, m.id, config.now()).jummah;
    res.json({
      mosque: { id: m.id, name: m.name, city: m.city, timezone: m.timezone },
      role: req.role,
      date: now.date,
      today: todayDay,
      nextEvent: computeNextEvent(days, jummah, now),
      status: publishStatus(db, m.id),
      devices: devicesFor(m.id),
    });
  });

  // ---- Publish ----
  r.get('/publish/status', editor, (req, res) => res.json(publishStatus(db, req.mosqueId!)));
  r.get('/preview', editor, (req, res) => {
    res.json({
      version: 0,
      publishedAt: config.now().toISOString(),
      preview: true,
      ...buildSnapshotPayload(db, req.mosqueId!, config.now()),
    });
  });
  r.post('/publish', editor, requireVerifiedEmail, (req, res) => {
    const result = publishSnapshot(db, req.mosqueId!, req.user!.id, config.now());
    res
      .status(201)
      .json({ version: result.version, publishedAt: result.snapshot.publishedAt, snapshot: result.snapshot });
  });
  r.post('/pause', admin, (req, res) => {
    const { paused } = z.object({ paused: z.boolean() }).parse(req.body);
    setPaused(db, req.mosqueId!, req.user!.id, paused);
    res.json(publishStatus(db, req.mosqueId!));
  });

  // ---- Devices ----
  r.get('/devices', admin, (req, res) => res.json(devicesFor(req.mosqueId!)));
  r.post(
    '/devices/pair',
    admin,
    requireVerifiedEmail,
    limiter('pairing-claim', config.rateLimits.pairingClaim),
    (req, res) => {
      const b = z
        .object({ code: z.string().trim(), name: z.string().trim().min(1).max(80).default('Prayer Hall TV') })
        .parse(req.body);
      const out = claimPairingCode(db, req.mosqueId!, req.user!.id, b.code, b.name, config.now());
      res.status(201).json({ deviceId: out.deviceId, name: b.name });
    },
  );
  r.delete('/devices/:id', admin, (req, res) => {
    const info = db
      .prepare('UPDATE devices SET revoked_at = ? WHERE id = ? AND mosque_id = ? AND revoked_at IS NULL')
      .run(config.now().toISOString(), intParam(req.params.id), req.mosqueId!);
    if (!info.changes) throw notFound('Device not found');
    logAudit(db, {
      mosqueId: req.mosqueId!,
      userId: req.user!.id,
      action: 'device.revoke',
      entityType: 'device',
      entityId: String(req.params.id),
    });
    res.json({ ok: true });
  });

  // ---- Users ----
  // Admins may manage editors; only owners may grant or change admin/owner roles.
  const canAssign = (actor: Role, target: Role) => actor === 'owner' || ROLE_RANK[target] < ROLE_RANK[actor];
  const roleOf = (mosqueId: number, userId: number) =>
    (
      db
        .prepare('SELECT role FROM mosque_users WHERE mosque_id = ? AND user_id = ?')
        .get(mosqueId, userId) as { role: Role } | undefined
    )?.role;
  const ownerCount = (mosqueId: number) =>
    (
      db
        .prepare("SELECT COUNT(*) AS n FROM mosque_users WHERE mosque_id = ? AND role = 'owner'")
        .get(mosqueId) as { n: number }
    ).n;
  const zRole = z.enum(['owner', 'admin', 'editor']);

  r.get('/users', admin, (req, res) => {
    res.json(
      db
        .prepare(
          `SELECT u.id, u.email, u.name, mu.role, mu.created_at AS addedAt FROM mosque_users mu
           JOIN users u ON u.id = mu.user_id WHERE mu.mosque_id = ? ORDER BY mu.created_at`,
        )
        .all(req.mosqueId!),
    );
  });

  r.post('/users', admin, async (req, res) => {
    const b = z
      .object({
        email: z.string().trim().toLowerCase().pipe(z.email()),
        name: z.string().trim().min(1).max(100).optional(),
        role: zRole,
      })
      .parse(req.body);
    if (!canAssign(req.role!, b.role)) throw forbidden(`You cannot assign the ${b.role} role`);
    const mosque = getMosque(db, req.mosqueId!);
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(b.email) as
      { id: number } | undefined;
    if (user) {
      // Existing account: add directly and notify by email.
      if (roleOf(req.mosqueId!, user.id)) throw new HttpError(409, 'User is already a member of this mosque');
      db.prepare('INSERT INTO mosque_users (mosque_id, user_id, role) VALUES (?, ?, ?)').run(
        req.mosqueId!,
        user.id,
        b.role,
      );
      logAudit(db, {
        mosqueId: req.mosqueId!,
        userId: req.user!.id,
        action: 'user.add',
        entityType: 'user',
        entityId: user.id,
        details: { email: b.email, role: b.role },
      });
      const emailSent = await sendAddedEmail(config, b.email, req.user!.name, mosque.name, b.role);
      return void res
        .status(201)
        .json({ id: user.id, email: b.email, role: b.role, status: 'added', emailSent });
    }
    // New person: email a signed, single-use invitation link (7 days). No passwords are generated.
    const token = issueToken(db, config, {
      purpose: 'invite',
      email: b.email,
      mosqueId: req.mosqueId!,
      role: b.role,
      name: b.name ?? null,
      invitedBy: req.user!.id,
    });
    logAudit(db, {
      mosqueId: req.mosqueId!,
      userId: req.user!.id,
      action: 'user.invite',
      entityType: 'user',
      entityId: b.email,
      details: { email: b.email, role: b.role },
    });
    const emailSent = await sendInviteEmail(config, b.email, req.user!.name, mosque.name, b.role, token);
    res.status(201).json({ email: b.email, role: b.role, status: 'invited', emailSent });
  });

  r.get('/invites', admin, (req, res) => {
    res.json(
      db
        .prepare(
          `SELECT email, role, created_at AS invitedAt, expires_at AS expiresAt FROM email_tokens
           WHERE mosque_id = ? AND purpose = 'invite' AND used_at IS NULL AND expires_at > ? ORDER BY created_at`,
        )
        .all(req.mosqueId!, config.now().toISOString()),
    );
  });

  r.patch('/users/:userId', admin, (req, res) => {
    const { role } = z.object({ role: zRole }).parse(req.body);
    const userId = intParam(req.params.userId);
    const current = roleOf(req.mosqueId!, userId);
    if (!current) throw notFound('User is not a member of this mosque');
    if (!canAssign(req.role!, role) || !canAssign(req.role!, current))
      throw forbidden('Insufficient role to change this user');
    if (current === 'owner' && role !== 'owner' && ownerCount(req.mosqueId!) <= 1)
      throw badRequest('A mosque must keep at least one owner');
    db.prepare('UPDATE mosque_users SET role = ? WHERE mosque_id = ? AND user_id = ?').run(
      role,
      req.mosqueId!,
      userId,
    );
    logAudit(db, {
      mosqueId: req.mosqueId!,
      userId: req.user!.id,
      action: 'user.role',
      entityType: 'user',
      entityId: userId,
      details: { from: current, to: role },
    });
    res.json({ ok: true });
  });

  r.delete('/users/:userId', admin, (req, res) => {
    const userId = intParam(req.params.userId);
    const current = roleOf(req.mosqueId!, userId);
    if (!current) throw notFound('User is not a member of this mosque');
    if (!canAssign(req.role!, current)) throw forbidden('Insufficient role to remove this user');
    if (current === 'owner' && ownerCount(req.mosqueId!) <= 1)
      throw badRequest('A mosque must keep at least one owner');
    db.prepare('DELETE FROM mosque_users WHERE mosque_id = ? AND user_id = ?').run(req.mosqueId!, userId);
    logAudit(db, {
      mosqueId: req.mosqueId!,
      userId: req.user!.id,
      action: 'user.remove',
      entityType: 'user',
      entityId: userId,
    });
    res.json({ ok: true });
  });

  // ---- Audit log (read-only) ----
  r.get('/audit', admin, (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit ?? 100) || 100, 1), 500);
    const rows = db
      .prepare(
        `SELECT a.id, a.action, a.entity_type AS entityType, a.entity_id AS entityId, a.details, a.created_at AS createdAt,
                u.email AS userEmail
         FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
         WHERE a.mosque_id = ? ORDER BY a.id DESC LIMIT ?`,
      )
      .all(req.mosqueId!, limit) as { details: string | null }[];
    res.json(rows.map((a) => ({ ...a, details: a.details ? JSON.parse(a.details) : null })));
  });

  return r;
}

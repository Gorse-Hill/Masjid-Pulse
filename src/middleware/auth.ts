import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { DB } from '../db/db.js';
import type { AppConfig } from '../config.js';
import { HttpError, forbidden } from './errors.js';
import { sha256 } from '../services/crypto.js';

export type Role = 'owner' | 'admin' | 'editor';
export const ROLE_RANK: Record<Role, number> = { editor: 1, admin: 2, owner: 3 };

export interface AuthedUser {
  id: number;
  email: string;
  name: string;
  emailVerified: boolean;
}

export interface DeviceCtx {
  id: number;
  mosqueId: number;
  name: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthedUser;
    mosqueId?: number;
    role?: Role;
    device?: DeviceCtx;
  }
}

/** Session JWT. `tv` (token version) lets a password reset/change invalidate older sessions. */
export function signToken(config: AppConfig, userId: number, tokenVersion = 0): string {
  return jwt.sign({ sub: String(userId), tv: tokenVersion }, config.jwtSecret, { expiresIn: '30d' });
}

export function requireUser(db: DB, config: AppConfig) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const header = req.header('authorization') ?? '';
    const m = /^Bearer (.+)$/.exec(header);
    if (!m) return next(new HttpError(401, 'Authentication required'));
    try {
      const payload = jwt.verify(m[1], config.jwtSecret) as jwt.JwtPayload;
      const row = db
        .prepare('SELECT id, email, name, email_verified_at, token_version FROM users WHERE id = ?')
        .get(Number(payload.sub)) as
        | { id: number; email: string; name: string; email_verified_at: string | null; token_version: number }
        | undefined;
      if (!row || (payload.tv ?? 0) !== row.token_version) return next(new HttpError(401, 'Invalid token'));
      req.user = { id: row.id, email: row.email, name: row.name, emailVerified: !!row.email_verified_at };
      next();
    } catch {
      next(new HttpError(401, 'Invalid or expired token'));
    }
  };
}

/**
 * Mosque-scoped authorisation: the user must be a member of :mosqueId with at least `minRole`.
 * Sets req.mosqueId which every handler then uses to scope queries (tenant isolation).
 */
export function requireMosqueRole(db: DB, minRole: Role) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const mosqueId = Number(req.params.mosqueId);
    if (!Number.isInteger(mosqueId) || mosqueId <= 0) return next(new HttpError(400, 'Invalid mosque id'));
    const row = db
      .prepare('SELECT role FROM mosque_users WHERE mosque_id = ? AND user_id = ?')
      .get(mosqueId, req.user!.id) as { role: Role } | undefined;
    if (!row) return next(forbidden('You are not a member of this mosque'));
    if (ROLE_RANK[row.role] < ROLE_RANK[minRole]) return next(forbidden(`Requires ${minRole} role`));
    req.mosqueId = mosqueId;
    req.role = row.role;
    next();
  };
}

export function requireDevice(db: DB, config: AppConfig) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const header = req.header('authorization') ?? '';
    const m = /^Device (.+)$/.exec(header);
    if (!m) return next(new HttpError(401, 'Device token required'));
    const device = db
      .prepare('SELECT id, mosque_id AS mosqueId, name, revoked_at FROM devices WHERE token_hash = ?')
      .get(sha256(m[1])) as (DeviceCtx & { revoked_at: string | null }) | undefined;
    if (!device || device.revoked_at) return next(new HttpError(401, 'Device not paired or revoked'));
    db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(config.now().toISOString(), device.id);
    req.device = { id: device.id, mosqueId: device.mosqueId, name: device.name };
    next();
  };
}

/** Actions that affect what TVs show require a verified email address. */
export function requireVerifiedEmail(req: Request, _res: Response, next: NextFunction) {
  if (!req.user?.emailVerified) {
    return next(
      new HttpError(403, 'Please verify your email address first (check your inbox or resend the email)'),
    );
  }
  next();
}

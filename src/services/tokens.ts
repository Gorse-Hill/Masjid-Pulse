/**
 * Signed, expiring, single-use tokens for email links.
 * Token = base64url(JSON {id, p(urpose), exp, n(once)}) + "." + base64url(HMAC-SHA256(secret, payload)).
 * The DB stores only SHA-256(token) and marks the row used atomically on consumption.
 */
import crypto from 'node:crypto';
import type { DB } from '../db/db.js';
import type { AppConfig } from '../config.js';
import { HttpError } from '../middleware/errors.js';
import { sha256, uuid } from './crypto.js';

export type TokenPurpose = 'verify' | 'reset' | 'invite';
export const TOKEN_TTL_MS: Record<TokenPurpose, number> = {
  verify: 48 * 3600_000,
  reset: 3600_000,
  invite: 7 * 24 * 3600_000,
};

export interface TokenRow {
  id: string;
  purpose: TokenPurpose;
  user_id: number | null;
  email: string;
  mosque_id: number | null;
  role: 'owner' | 'admin' | 'editor' | null;
  name: string | null;
  invited_by: number | null;
  token_hash: string;
  expires_at: string;
  used_at: string | null;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const sign = (secret: string, payload: string) =>
  crypto.createHmac('sha256', `email-token:${secret}`).update(payload).digest('base64url');

export function issueToken(
  db: DB,
  config: AppConfig,
  t: {
    purpose: TokenPurpose;
    email: string;
    userId?: number | null;
    mosqueId?: number | null;
    role?: TokenRow['role'];
    name?: string | null;
    invitedBy?: number | null;
  },
): string {
  const id = uuid();
  const exp = config.now().getTime() + TOKEN_TTL_MS[t.purpose];
  const payload = b64(
    JSON.stringify({ id, p: t.purpose, exp, n: crypto.randomBytes(16).toString('base64url') }),
  );
  const token = `${payload}.${sign(config.jwtSecret, payload)}`;
  db.prepare(
    `INSERT INTO email_tokens (id, purpose, user_id, email, mosque_id, role, name, invited_by, token_hash, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    t.purpose,
    t.userId ?? null,
    t.email,
    t.mosqueId ?? null,
    t.role ?? null,
    t.name ?? null,
    t.invitedBy ?? null,
    sha256(token),
    new Date(exp).toISOString(),
  );
  return token;
}

const invalid = () => new HttpError(400, 'This link is invalid or has expired. Please request a new one.');

/** Verify signature, purpose, expiry and single use; marks the token used. Call inside a transaction. */
export function consumeToken(db: DB, config: AppConfig, token: string, purpose: TokenPurpose): TokenRow {
  const [payload, sig] = String(token).split('.');
  if (!payload || !sig) throw invalid();
  const expected = sign(config.jwtSecret, payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw invalid();
  }
  let data: { id?: string; p?: string; exp?: number };
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  if (data.p !== purpose || typeof data.exp !== 'number' || data.exp <= config.now().getTime())
    throw invalid();
  const row = db.prepare('SELECT * FROM email_tokens WHERE id = ?').get(data.id) as TokenRow | undefined;
  if (!row || row.purpose !== purpose || row.token_hash !== sha256(token)) throw invalid();
  const used = db
    .prepare('UPDATE email_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?')
    .run(config.now().toISOString(), row.id, config.now().toISOString());
  if (used.changes !== 1) throw invalid();
  return row;
}

/** Invalidate outstanding tokens of a purpose for a user (e.g. older reset links). */
export function revokeTokens(db: DB, config: AppConfig, userId: number, purpose: TokenPurpose): void {
  db.prepare('UPDATE email_tokens SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL').run(
    config.now().toISOString(),
    userId,
    purpose,
  );
}

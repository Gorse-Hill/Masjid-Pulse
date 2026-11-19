import type { DB } from '../db/db.js';
import { fiveDigitCode, randomToken, safeEqual, sha256, uuid } from './crypto.js';
import { HttpError, badRequest } from '../middleware/errors.js';
import { logAudit } from './audit.js';

export interface PairingRequest {
  pairingId: string;
  pairingSecret: string;
  code: string;
  expiresAt: string;
}

/** Called by an unpaired TV. Generates a 5-digit code unique among currently-live codes. */
export function createPairingCode(db: DB, now: Date, ttlMs: number): PairingRequest {
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  const isLive = db.prepare(
    'SELECT 1 FROM pairing_codes WHERE code = ? AND claimed_at IS NULL AND expires_at > ? LIMIT 1',
  );
  let code = '';
  for (let i = 0; i < 50; i++) {
    const c = fiveDigitCode();
    if (!isLive.get(c, nowIso)) {
      code = c;
      break;
    }
  }
  if (!code) throw new HttpError(503, 'Could not allocate pairing code, try again');
  const pairingId = uuid();
  const pairingSecret = randomToken(24);
  db.prepare(
    'INSERT INTO pairing_codes (id, code, secret_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  ).run(pairingId, code, sha256(pairingSecret), nowIso, expiresAt);
  return { pairingId, pairingSecret, code, expiresAt };
}

interface PairingRow {
  id: string;
  code: string;
  secret_hash: string;
  expires_at: string;
  claimed_at: string | null;
  mosque_id: number | null;
  device_id: number | null;
  pending_token: string | null;
  delivered_at: string | null;
}

export type PairingStatus =
  | { status: 'pending'; code: string; expiresAt: string }
  | { status: 'expired' }
  | { status: 'paired'; deviceToken: string; deviceId: number; mosqueId: number }
  | { status: 'consumed' };

/**
 * Polled by the TV with its pairing secret. When the code has been claimed the device token is
 * returned exactly once and then wiped from the database.
 */
export function getPairingStatus(db: DB, pairingId: string, secret: string, now: Date): PairingStatus {
  const row = db.prepare('SELECT * FROM pairing_codes WHERE id = ?').get(pairingId) as PairingRow | undefined;
  if (!row || !safeEqual(row.secret_hash, sha256(secret)))
    throw new HttpError(404, 'Unknown pairing request');
  if (row.claimed_at) {
    if (row.pending_token && !row.delivered_at) {
      db.prepare('UPDATE pairing_codes SET pending_token = NULL, delivered_at = ? WHERE id = ?').run(
        now.toISOString(),
        row.id,
      );
      return {
        status: 'paired',
        deviceToken: row.pending_token,
        deviceId: row.device_id!,
        mosqueId: row.mosque_id!,
      };
    }
    return { status: 'consumed' };
  }
  if (row.expires_at <= now.toISOString()) return { status: 'expired' };
  return { status: 'pending', code: row.code, expiresAt: row.expires_at };
}

/**
 * Called by an admin who typed the code shown on the TV. Codes are one-time use and expire
 * after the TTL. Claiming creates the Device for the admin's mosque.
 */
export function claimPairingCode(
  db: DB,
  mosqueId: number,
  userId: number,
  code: string,
  deviceName: string,
  now: Date,
): { deviceId: number } {
  if (!/^\d{5}$/.test(code)) throw badRequest('Pairing code must be 5 digits');
  return db
    .transaction(() => {
      const nowIso = now.toISOString();
      const row = db
        .prepare(
          'SELECT * FROM pairing_codes WHERE code = ? AND claimed_at IS NULL ORDER BY created_at DESC LIMIT 1',
        )
        .get(code) as PairingRow | undefined;
      if (!row) throw new HttpError(404, 'Pairing code not found or already used');
      if (row.expires_at <= nowIso)
        throw new HttpError(410, 'Pairing code has expired. Restart pairing on the TV.');
      const token = randomToken(32);
      const dev = db
        .prepare('INSERT INTO devices (mosque_id, name, token_hash, created_at) VALUES (?, ?, ?, ?)')
        .run(mosqueId, deviceName, sha256(token), nowIso);
      const deviceId = Number(dev.lastInsertRowid);
      const upd = db
        .prepare(
          `UPDATE pairing_codes SET claimed_at = ?, mosque_id = ?, device_id = ?, pending_token = ?
           WHERE id = ? AND claimed_at IS NULL`,
        )
        .run(nowIso, mosqueId, deviceId, token, row.id);
      if (upd.changes !== 1) throw new HttpError(409, 'Pairing code already used');
      logAudit(db, {
        mosqueId,
        userId,
        action: 'device.pair',
        entityType: 'device',
        entityId: deviceId,
        details: { name: deviceName },
      });
      return { deviceId };
    })
    .immediate();
}

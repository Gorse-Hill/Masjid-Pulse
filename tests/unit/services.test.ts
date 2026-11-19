import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, migrate, type DB } from '../../src/db/db.js';
import { MIGRATIONS } from '../../src/db/schema.js';
import { claimPairingCode, createPairingCode, getPairingStatus } from '../../src/services/pairing.js';
import { getEffectiveDay, setIqamah, upsertSchedule, clearOverrides } from '../../src/services/prayers.js';
import {
  displaySnapshotFor,
  publishSnapshot,
  publishStatus,
  setPaused,
} from '../../src/services/snapshot.js';
import { bumpRevision, logAudit } from '../../src/services/audit.js';
import { seed } from '../../src/scripts/seed.js';

const TEN_MIN = 10 * 60 * 1000;
const times = [
  { key: 'fajr' as const, adhan: '05:00', iqamah: '05:30' },
  { key: 'dhuhr' as const, adhan: '12:30', iqamah: '13:00' },
  { key: 'asr' as const, adhan: '15:45', iqamah: '16:00' },
  { key: 'maghrib' as const, adhan: '18:05', iqamah: '18:10' },
  { key: 'isha' as const, adhan: '19:30', iqamah: '19:45' },
];

let db: DB;
let mosqueId: number;
let userId: number;
beforeEach(() => {
  db = openDatabase(':memory:');
  userId = Number(
    db.prepare("INSERT INTO users (email, password_hash, name) VALUES ('a@b.c','x','A')").run()
      .lastInsertRowid,
  );
  mosqueId = Number(
    db.prepare("INSERT INTO mosques (name, timezone) VALUES ('M', 'UTC')").run().lastInsertRowid,
  );
  db.prepare("INSERT INTO mosque_users (mosque_id, user_id, role) VALUES (?, ?, 'owner')").run(
    mosqueId,
    userId,
  );
});

describe('migrations', () => {
  it('are idempotent', () => {
    migrate(db);
    const n = db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number };
    expect(n.n).toBe(MIGRATIONS.length);
  });
});

describe('pairing service', () => {
  it('generates a 5-digit code with a 10 minute expiry', () => {
    const now = new Date('2026-10-11T10:00:00Z');
    const p = createPairingCode(db, now, TEN_MIN);
    expect(p.code).toMatch(/^\d{5}$/);
    expect(new Date(p.expiresAt).getTime() - now.getTime()).toBe(TEN_MIN);
    expect(getPairingStatus(db, p.pairingId, p.pairingSecret, now)).toMatchObject({
      status: 'pending',
      code: p.code,
    });
  });
  it('rejects claims after expiry', () => {
    const now = new Date('2026-10-11T10:00:00Z');
    const p = createPairingCode(db, now, TEN_MIN);
    const later = new Date(now.getTime() + TEN_MIN);
    expect(() => claimPairingCode(db, mosqueId, userId, p.code, 'TV', later)).toThrow(/expired/);
    expect(getPairingStatus(db, p.pairingId, p.pairingSecret, later)).toEqual({ status: 'expired' });
  });
  it('accepts a claim just before expiry and is one-time use', () => {
    const now = new Date('2026-10-11T10:00:00Z');
    const p = createPairingCode(db, now, TEN_MIN);
    const almost = new Date(now.getTime() + TEN_MIN - 1000);
    expect(claimPairingCode(db, mosqueId, userId, p.code, 'TV', almost).deviceId).toBeGreaterThan(0);
    expect(() => claimPairingCode(db, mosqueId, userId, p.code, 'TV2', almost)).toThrow(
      /not found or already used/,
    );
    const first = getPairingStatus(db, p.pairingId, p.pairingSecret, almost);
    expect(first.status).toBe('paired');
    // token is delivered only once and wiped from storage
    expect(getPairingStatus(db, p.pairingId, p.pairingSecret, almost)).toEqual({ status: 'consumed' });
    const row = db.prepare('SELECT pending_token FROM pairing_codes WHERE id = ?').get(p.pairingId) as {
      pending_token: string | null;
    };
    expect(row.pending_token).toBeNull();
  });
  it('requires the pairing secret to poll', () => {
    const p = createPairingCode(db, new Date(), TEN_MIN);
    expect(() => getPairingStatus(db, p.pairingId, 'wrong', new Date())).toThrow(/Unknown pairing/);
  });
  it('rejects malformed codes', () => {
    expect(() => claimPairingCode(db, mosqueId, userId, '12ab', 'TV', new Date())).toThrow(/5 digits/);
  });
});

describe('prayer schedule service', () => {
  it('carries the latest schedule forward to later dates', () => {
    upsertSchedule(db, mosqueId, '2026-10-11', times);
    expect(getEffectiveDay(db, mosqueId, '2026-10-20')!.prayers[0].adhan).toBe('05:00');
    expect(getEffectiveDay(db, mosqueId, '2026-10-10')).toBeNull();
  });
  it('"today only" iqamah override applies to one date only', () => {
    upsertSchedule(db, mosqueId, '2026-10-11', times);
    setIqamah(db, mosqueId, '2026-10-11', 'isha', '20:00', true);
    expect(getEffectiveDay(db, mosqueId, '2026-10-11')!.prayers[4]).toMatchObject({
      iqamah: '20:00',
      overridden: true,
    });
    expect(getEffectiveDay(db, mosqueId, '2026-10-12')!.prayers[4].iqamah).toBe('19:45');
    expect(clearOverrides(db, mosqueId, '2026-10-11')).toBe(1);
    expect(getEffectiveDay(db, mosqueId, '2026-10-11')!.prayers[4].iqamah).toBe('19:45');
  });
  it('persistent iqamah update carries forward and replaces a same-day override', () => {
    upsertSchedule(db, mosqueId, '2026-10-01', times);
    setIqamah(db, mosqueId, '2026-10-11', 'fajr', '05:40', true);
    setIqamah(db, mosqueId, '2026-10-11', 'fajr', '05:50', false);
    expect(getEffectiveDay(db, mosqueId, '2026-10-11')!.prayers[0]).toEqual({
      key: 'fajr',
      name: 'Fajr',
      adhan: '05:00',
      iqamah: '05:50',
    });
    expect(getEffectiveDay(db, mosqueId, '2026-10-15')!.prayers[0].iqamah).toBe('05:50');
    expect(getEffectiveDay(db, mosqueId, '2026-10-05')!.prayers[0].iqamah).toBe('05:30');
  });
  it('rejects invalid iqamah and missing schedules', () => {
    expect(() => setIqamah(db, mosqueId, '2026-10-11', 'fajr', '05:40', true)).toThrow(/No prayer schedule/);
    upsertSchedule(db, mosqueId, '2026-10-11', times);
    expect(() => setIqamah(db, mosqueId, '2026-10-11', 'fajr', '04:00', true)).toThrow(/Invalid iqamah/);
    expect(() => upsertSchedule(db, mosqueId, '2026-10-11', times.slice(0, 4))).toThrow(/Missing Isha/);
  });
});

describe('snapshot service', () => {
  it('publishes versioned snapshots atomically and tracks unpublished changes', () => {
    expect(() => publishSnapshot(db, mosqueId, userId, new Date())).toThrow(/Enter prayer times/);
    expect(db.prepare('SELECT COUNT(*) AS n FROM display_snapshots').get()).toEqual({ n: 0 });
    upsertSchedule(db, mosqueId, '2026-10-11', times);
    bumpRevision(db, mosqueId);
    expect(publishStatus(db, mosqueId).hasUnpublishedChanges).toBe(true);
    const s1 = publishSnapshot(db, mosqueId, userId, new Date('2026-10-11T08:00:00Z'));
    expect(s1.version).toBe(1);
    expect(s1.snapshot.days).toHaveLength(14);
    expect(publishStatus(db, mosqueId).hasUnpublishedChanges).toBe(false);
    const s2 = publishSnapshot(db, mosqueId, userId, new Date('2026-10-11T08:01:00Z'));
    expect(s2.version).toBe(2);
    expect(displaySnapshotFor(db, mosqueId)!.snapshot.version).toBe(2);
  });
  it('emergency pause freezes the TV on the last approved snapshot and blocks publishing', () => {
    upsertSchedule(db, mosqueId, '2026-10-11', times);
    publishSnapshot(db, mosqueId, userId, new Date('2026-10-11T08:00:00Z'));
    setPaused(db, mosqueId, userId, true);
    expect(() => publishSnapshot(db, mosqueId, userId, new Date())).toThrow(/paused/);
    expect(displaySnapshotFor(db, mosqueId)).toMatchObject({ paused: true, snapshot: { version: 1 } });
    setPaused(db, mosqueId, userId, false);
    expect(publishSnapshot(db, mosqueId, userId, new Date('2026-10-11T08:05:00Z')).version).toBe(2);
  });
});

describe('audit log', () => {
  it('is append-only (UPDATE and DELETE are rejected by the database)', () => {
    logAudit(db, { mosqueId, userId, action: 'test.action', details: { a: 1 } });
    expect(() => db.prepare("UPDATE audit_logs SET action = 'tampered'").run()).toThrow(/append-only/);
    expect(() => db.prepare('DELETE FROM audit_logs').run()).toThrow(/append-only/);
    expect(db.prepare('SELECT action FROM audit_logs').get()).toEqual({ action: 'test.action' });
  });
});

describe('seed script', () => {
  it('creates a demo mosque with a published snapshot and is idempotent', () => {
    const a = seed(db, 'UTC', new Date('2026-10-11T08:00:00Z'));
    expect(a.created).toBe(true);
    expect(displaySnapshotFor(db, a.mosqueId)!.snapshot.announcements).toHaveLength(2);
    expect(seed(db, 'UTC')).toEqual({ mosqueId: a.mosqueId, created: false });
  });
});

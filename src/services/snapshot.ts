import type { DB } from '../db/db.js';
import { type DisplaySnapshot, type SnapshotSource, addDays, localNow } from '../shared/display.js';
import { datesAround, snapshotDaysFor } from '../shared/prayertimes.js';
import {
  getBaseSchedule,
  getCalcSettings,
  getEffectiveRange,
  getIqamahRules,
  overridesFrom,
} from './prayers.js';
import { conflict, notFound } from '../middleware/errors.js';
import { logAudit } from './audit.js';

/** Number of days of prayer times embedded in each snapshot (offline runway for the TV). */
export const SNAPSHOT_DAYS = 14;

interface MosqueRow {
  id: number;
  name: string;
  city: string | null;
  timezone: string;
  paused: number;
  paused_snapshot_id: number | null;
  draft_revision: number;
}

export function getMosque(db: DB, mosqueId: number): MosqueRow {
  const m = db.prepare('SELECT * FROM mosques WHERE id = ?').get(mosqueId) as MosqueRow | undefined;
  if (!m) throw notFound('Mosque not found');
  return m;
}

/** Build (but do not persist) the display payload from current draft data. */
export function buildSnapshotPayload(
  db: DB,
  mosqueId: number,
  now: Date,
): Omit<DisplaySnapshot, 'version' | 'publishedAt'> {
  const m = getMosque(db, mosqueId);
  const today = localNow(m.timezone, now).date;
  const days = getEffectiveRange(db, mosqueId, today, SNAPSHOT_DAYS);
  const jummah = db
    .prepare(
      `SELECT label, khutbah_time AS khutbah, iqamah_time AS iqamah, language
       FROM jummah_schedules WHERE mosque_id = ? ORDER BY sort_order, iqamah_time`,
    )
    .all(mosqueId) as DisplaySnapshot['jummah'];
  // Expired announcements are excluded; future ones are included so the TV can show them
  // on the right day even while offline. The TV filters by date again at render time.
  const announcements = db
    .prepare(
      `SELECT id, title, body, start_date AS startDate, end_date AS endDate FROM announcements
       WHERE mosque_id = ? AND deleted_at IS NULL AND end_date >= ? ORDER BY start_date, id`,
    )
    .all(mosqueId, today) as DisplaySnapshot['announcements'];
  const slides = (
    db
      .prepare(
        `SELECT id, filename, caption, duration_sec AS durationSec FROM slides
         WHERE mosque_id = ? AND deleted_at IS NULL AND active = 1 ORDER BY sort_order, id`,
      )
      .all(mosqueId) as { id: number; filename: string; caption: string | null; durationSec: number }[]
  ).map((s) => ({ id: s.id, url: `/uploads/${s.filename}`, caption: s.caption, durationSec: s.durationSec }));
  const calc = getCalcSettings(db, mosqueId);
  const overrides = overridesFrom(db, mosqueId, today);
  const source: SnapshotSource = calc
    ? { mode: 'calculated', calc, rules: getIqamahRules(db, mosqueId), overrides }
    : {
        mode: 'manual',
        manualBase: getBaseSchedule(db, mosqueId, addDays(today, SNAPSHOT_DAYS - 1))?.times,
        overrides,
      };
  return {
    mosque: { id: m.id, name: m.name, city: m.city, timezone: m.timezone },
    days,
    source,
    jummah,
    announcements,
    slides,
  };
}

export interface PublishResult {
  id: number;
  version: number;
  snapshot: DisplaySnapshot;
}

/**
 * Atomically generate and persist a new DisplaySnapshot. All reads and the insert happen in one
 * transaction so the TV never sees a half-built snapshot.
 */
export function publishSnapshot(db: DB, mosqueId: number, userId: number | null, now: Date): PublishResult {
  return db
    .transaction((): PublishResult => {
      const m = getMosque(db, mosqueId);
      if (m.paused) throw conflict('Display updates are paused for this mosque. Resume before publishing.');
      const payload = buildSnapshotPayload(db, mosqueId, now);
      if (payload.days.length === 0) throw conflict('Enter prayer times before publishing');
      const last = db
        .prepare('SELECT COALESCE(MAX(version), 0) AS v FROM display_snapshots WHERE mosque_id = ?')
        .get(mosqueId) as { v: number };
      const version = last.v + 1;
      const snapshot: DisplaySnapshot = { version, publishedAt: now.toISOString(), ...payload };
      const info = db
        .prepare(
          `INSERT INTO display_snapshots (mosque_id, version, payload, source_revision, published_by, published_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(mosqueId, version, JSON.stringify(snapshot), m.draft_revision, userId, snapshot.publishedAt);
      logAudit(db, {
        mosqueId,
        userId,
        action: 'snapshot.publish',
        entityType: 'snapshot',
        entityId: version,
      });
      return { id: Number(info.lastInsertRowid), version, snapshot };
    })
    .immediate();
}

interface SnapshotRow {
  id: number;
  version: number;
  payload: string;
  source_revision: number;
  published_at: string;
}

export function latestSnapshotRow(db: DB, mosqueId: number): SnapshotRow | undefined {
  return db
    .prepare('SELECT * FROM display_snapshots WHERE mosque_id = ? ORDER BY version DESC LIMIT 1')
    .get(mosqueId) as SnapshotRow | undefined;
}

/** The snapshot a TV should render: the paused snapshot if paused, else the latest published one. */
export function displaySnapshotFor(
  db: DB,
  mosqueId: number,
): { snapshot: DisplaySnapshot; paused: boolean } | null {
  const m = getMosque(db, mosqueId);
  let row: SnapshotRow | undefined;
  if (m.paused && m.paused_snapshot_id) {
    row = db
      .prepare('SELECT * FROM display_snapshots WHERE id = ? AND mosque_id = ?')
      .get(m.paused_snapshot_id, mosqueId) as SnapshotRow | undefined;
  } else {
    row = latestSnapshotRow(db, mosqueId);
  }
  if (!row) return null;
  return { snapshot: JSON.parse(row.payload) as DisplaySnapshot, paused: !!m.paused };
}

/** Refresh when fewer than this many days (from today) remain in the latest snapshot. */
export const REFRESH_WHEN_DAYS_LEFT = 7;

/**
 * Daily rolling refresh: if the latest published snapshot is running out of days, publish a new
 * version generated ONLY from the published snapshot's embedded inputs (never from unapproved
 * drafts). Expired announcements are dropped. Skipped while paused.
 * Returns the new version or null if nothing was done.
 */
export function refreshSnapshotIfStale(db: DB, mosqueId: number, now: Date): number | null {
  return db
    .transaction((): number | null => {
      const m = getMosque(db, mosqueId);
      if (m.paused) return null;
      const last = latestSnapshotRow(db, mosqueId);
      if (!last) return null;
      const snap = JSON.parse(last.payload) as DisplaySnapshot;
      const today = localNow(snap.mosque.timezone, now).date;
      const remaining = snap.days.filter((d) => d.date >= today).length;
      if (remaining >= REFRESH_WHEN_DAYS_LEFT) return null;
      const days = snapshotDaysFor(snap, datesAround(today, 0, SNAPSHOT_DAYS - 1));
      if (days.length <= remaining) return null; // nothing new can be generated (e.g. legacy snapshot)
      const version = last.version + 1;
      const next: DisplaySnapshot = {
        ...snap,
        version,
        publishedAt: now.toISOString(),
        days,
        announcements: snap.announcements.filter((a) => a.endDate >= today),
        source: snap.source && {
          ...snap.source,
          overrides: snap.source.overrides.filter((o) => o.date >= today),
        },
      };
      db.prepare(
        `INSERT INTO display_snapshots (mosque_id, version, payload, source_revision, published_by, published_at)
         VALUES (?, ?, ?, ?, NULL, ?)`,
      ).run(mosqueId, version, JSON.stringify(next), last.source_revision, next.publishedAt);
      logAudit(db, {
        mosqueId,
        userId: null,
        action: 'snapshot.auto_refresh',
        entityType: 'snapshot',
        entityId: version,
      });
      return version;
    })
    .immediate();
}

/** Refresh every mosque's snapshot if needed (run by the server's daily/hourly job). */
export function refreshAllSnapshots(db: DB, now: Date): number {
  const ids = db.prepare('SELECT DISTINCT mosque_id AS id FROM display_snapshots').all() as { id: number }[];
  let n = 0;
  for (const { id } of ids) if (refreshSnapshotIfStale(db, id, now) !== null) n++;
  return n;
}

export function publishStatus(db: DB, mosqueId: number) {
  const m = getMosque(db, mosqueId);
  const last = latestSnapshotRow(db, mosqueId);
  return {
    paused: !!m.paused,
    draftRevision: m.draft_revision,
    lastPublished: last ? { version: last.version, publishedAt: last.published_at } : null,
    hasUnpublishedChanges: !last || last.source_revision < m.draft_revision,
  };
}

export function setPaused(db: DB, mosqueId: number, userId: number, paused: boolean): void {
  db.transaction(() => {
    const last = latestSnapshotRow(db, mosqueId);
    db.prepare('UPDATE mosques SET paused = ?, paused_snapshot_id = ? WHERE id = ?').run(
      paused ? 1 : 0,
      paused ? (last?.id ?? null) : null,
      mosqueId,
    );
    logAudit(db, {
      mosqueId,
      userId,
      action: paused ? 'display.pause' : 'display.resume',
      entityType: 'mosque',
      entityId: mosqueId,
    });
  })();
}

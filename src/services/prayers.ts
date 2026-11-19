import type { DB } from '../db/db.js';
import {
  type CalcMethodKey,
  type CalcSettings,
  type HighLatRuleKey,
  type IqamahRule,
  type IqamahRules,
  PRAYER_KEYS,
  PRAYER_NAMES,
  type PrayerKey,
  type SnapshotDay,
  addDays,
  timeToMinutes,
  validateDay,
} from '../shared/display.js';
import { DEFAULT_IQAMAH_RULES, computeDay, manualDay } from '../shared/prayertimes.js';
import { badRequest } from '../middleware/errors.js';

export interface DayTimes {
  key: PrayerKey;
  adhan: string;
  iqamah: string | null;
}

type ScheduleRow = Record<string, string | null> & { date: string };

function rowToTimes(row: ScheduleRow): DayTimes[] {
  return PRAYER_KEYS.map((k) => ({
    key: k,
    adhan: row[`${k}_adhan`] as string,
    iqamah: (row[`${k}_iqamah`] as string | null) ?? null,
  }));
}

/** Exact schedule row for a date, or undefined. */
export function getScheduleRow(db: DB, mosqueId: number, date: string): ScheduleRow | undefined {
  return db.prepare('SELECT * FROM prayer_schedules WHERE mosque_id = ? AND date = ?').get(mosqueId, date) as
    ScheduleRow | undefined;
}

/**
 * Base schedule for a date: the exact row if present, otherwise the most recent earlier row
 * ("carry forward"), so volunteers only need to enter times when they change.
 */
export function getBaseSchedule(
  db: DB,
  mosqueId: number,
  date: string,
): { times: DayTimes[]; sourceDate: string } | null {
  const row = db
    .prepare('SELECT * FROM prayer_schedules WHERE mosque_id = ? AND date <= ? ORDER BY date DESC LIMIT 1')
    .get(mosqueId, date) as ScheduleRow | undefined;
  if (!row) return null;
  return { times: rowToTimes(row), sourceDate: row.date };
}

export interface OverrideRow {
  prayer: PrayerKey;
  adhan: string | null;
  iqamah: string | null;
}

export function getOverrides(db: DB, mosqueId: number, date: string): OverrideRow[] {
  return db
    .prepare('SELECT prayer, adhan, iqamah FROM prayer_overrides WHERE mosque_id = ? AND date = ?')
    .all(mosqueId, date) as OverrideRow[];
}

export interface MosqueCalcRow {
  prayer_source: 'manual' | 'calculated';
  latitude: number | null;
  longitude: number | null;
  timezone: string;
  calc_method: string;
  madhab: string;
  high_lat_rule: string;
}

/** Calculation settings for a mosque, or null when it uses manual times / has no location. */
export function getCalcSettings(db: DB, mosqueId: number): CalcSettings | null {
  const m = db
    .prepare(
      'SELECT prayer_source, latitude, longitude, timezone, calc_method, madhab, high_lat_rule FROM mosques WHERE id = ?',
    )
    .get(mosqueId) as MosqueCalcRow | undefined;
  if (!m || m.prayer_source !== 'calculated' || m.latitude === null || m.longitude === null) return null;
  return {
    latitude: m.latitude,
    longitude: m.longitude,
    timezone: m.timezone,
    method: m.calc_method as CalcMethodKey,
    madhab: m.madhab as 'shafi' | 'hanafi',
    highLatitudeRule: m.high_lat_rule as HighLatRuleKey,
  };
}

interface RuleRow {
  prayer: PrayerKey;
  mode: IqamahRule['mode'];
  offset_minutes: number | null;
  fixed_time: string | null;
  round_to: number;
  round_mode: 'nearest' | 'up';
}

/** Iqamah rules for a mosque (defaults for prayers without a stored rule). */
export function getIqamahRules(db: DB, mosqueId: number): IqamahRules {
  const rows = db.prepare('SELECT * FROM iqamah_rules WHERE mosque_id = ?').all(mosqueId) as RuleRow[];
  const rules: IqamahRules = { ...DEFAULT_IQAMAH_RULES };
  for (const r of rows) {
    rules[r.prayer] = {
      mode: r.mode,
      offsetMinutes: r.offset_minutes ?? undefined,
      fixedTime: r.fixed_time,
      roundTo: r.round_to,
      roundMode: r.round_mode,
    };
  }
  return rules;
}

export function saveIqamahRule(db: DB, mosqueId: number, prayer: PrayerKey, rule: IqamahRule): void {
  db.prepare(
    `INSERT INTO iqamah_rules (mosque_id, prayer, mode, offset_minutes, fixed_time, round_to, round_mode)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (mosque_id, prayer) DO UPDATE SET mode = excluded.mode, offset_minutes = excluded.offset_minutes,
       fixed_time = excluded.fixed_time, round_to = excluded.round_to, round_mode = excluded.round_mode`,
  ).run(
    mosqueId,
    prayer,
    rule.mode,
    rule.offsetMinutes ?? null,
    rule.fixedTime ?? null,
    rule.roundTo ?? 0,
    rule.roundMode ?? 'nearest',
  );
}

/**
 * Effective day for display.
 *  - calculated mode: adhan from adhan-js, iqamah from rules; "today only" overrides win.
 *  - manual mode: carried-forward base schedule; "today only" overrides win.
 */
export function getEffectiveDay(db: DB, mosqueId: number, date: string): SnapshotDay | null {
  const overrides = getOverrides(db, mosqueId, date);
  const calc = getCalcSettings(db, mosqueId);
  if (calc) {
    try {
      const { sunrise: _sunrise, ...day } = computeDay(calc, getIqamahRules(db, mosqueId), date, overrides);
      return day;
    } catch {
      return null;
    }
  }
  const base = getBaseSchedule(db, mosqueId, date);
  if (!base) return null;
  return manualDay(date, base.times, overrides);
}

export function upsertSchedule(db: DB, mosqueId: number, date: string, times: DayTimes[]): void {
  const ordered = PRAYER_KEYS.map((k) => {
    const t = times.find((x) => x.key === k);
    if (!t) throw badRequest(`Missing ${PRAYER_NAMES[k]}`);
    return t;
  });
  const errors = validateDay(ordered);
  if (errors.length) throw badRequest('Invalid prayer times', errors);
  const cols = PRAYER_KEYS.flatMap((k) => [`${k}_adhan`, `${k}_iqamah`]);
  const values = ordered.flatMap((t) => [t.adhan, t.iqamah ?? null]);
  db.prepare(
    `INSERT INTO prayer_schedules (mosque_id, date, ${cols.join(', ')}, updated_at)
     VALUES (?, ?, ${cols.map(() => '?').join(', ')}, ?)
     ON CONFLICT (mosque_id, date) DO UPDATE SET ${cols.map((c) => `${c} = excluded.${c}`).join(', ')},
       updated_at = excluded.updated_at`,
  ).run(mosqueId, date, ...values, new Date().toISOString());
}

/**
 * Quick iqamah update.
 * todayOnly=true  -> stores a one-day override for `date` (does not carry forward).
 * todayOnly=false -> updates the base schedule for `date` (carried forward to later dates
 *                    that have no explicit row).
 */
export function setIqamah(
  db: DB,
  mosqueId: number,
  date: string,
  prayer: PrayerKey,
  iqamah: string,
  todayOnly: boolean,
): void {
  const calc = getCalcSettings(db, mosqueId);
  const base = calc ? null : getBaseSchedule(db, mosqueId, date);
  if (!calc && !base)
    throw badRequest('No prayer schedule exists yet for this date; enter full prayer times first');
  if (!todayOnly && calc) {
    // Calculated mode: a permanent change becomes a fixed-time iqamah rule for this prayer.
    const effective = getEffectiveDay(db, mosqueId, date);
    const adhan = effective?.prayers.find((p) => p.key === prayer);
    if (adhan && timeToMinutes(iqamah) < timeToMinutes(adhan.adhan) && !adhan.adhanDay) {
      throw badRequest('Invalid iqamah time', [`${PRAYER_NAMES[prayer]} iqamah is before adhan`]);
    }
    db.transaction(() => {
      const current = getIqamahRules(db, mosqueId)[prayer];
      saveIqamahRule(db, mosqueId, prayer, { ...current, mode: 'fixed', fixedTime: iqamah });
      db.prepare('DELETE FROM prayer_overrides WHERE mosque_id = ? AND date = ? AND prayer = ?').run(
        mosqueId,
        date,
        prayer,
      );
    })();
    return;
  }
  if (todayOnly) {
    // validate against the effective day
    const effective = getEffectiveDay(db, mosqueId, date);
    if (!effective) throw badRequest('Prayer times are not available for this date');
    const merged = effective.prayers.map((p) => (p.key === prayer ? { ...p, iqamah, iqamahDay: 0 } : p));
    const errors = validateDay(merged);
    if (errors.length) throw badRequest('Invalid iqamah time', errors);
    db.prepare(
      `INSERT INTO prayer_overrides (mosque_id, date, prayer, adhan, iqamah) VALUES (?, ?, ?, NULL, ?)
       ON CONFLICT (mosque_id, date, prayer) DO UPDATE SET iqamah = excluded.iqamah`,
    ).run(mosqueId, date, prayer, iqamah);
  } else {
    const times = base!.times.map((t) => (t.key === prayer ? { ...t, iqamah } : t));
    db.transaction(() => {
      upsertSchedule(db, mosqueId, date, times);
      db.prepare('DELETE FROM prayer_overrides WHERE mosque_id = ? AND date = ? AND prayer = ?').run(
        mosqueId,
        date,
        prayer,
      );
    })();
  }
}

/** "Today only" override of adhan and/or iqamah for one prayer on one date. */
export function setOverride(
  db: DB,
  mosqueId: number,
  date: string,
  prayer: PrayerKey,
  adhan: string | null,
  iqamah: string | null,
): void {
  const effective = getEffectiveDay(db, mosqueId, date);
  if (!effective) throw badRequest('Prayer times are not available for this date');
  const merged = effective.prayers.map((p) =>
    p.key === prayer
      ? {
          ...p,
          adhan: adhan ?? p.adhan,
          adhanDay: adhan ? 0 : p.adhanDay,
          iqamah: iqamah ?? p.iqamah,
          iqamahDay: iqamah ? 0 : p.iqamahDay,
        }
      : p,
  );
  const errors = validateDay(merged);
  if (errors.length) throw badRequest('Invalid override', errors);
  db.prepare(
    `INSERT INTO prayer_overrides (mosque_id, date, prayer, adhan, iqamah) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (mosque_id, date, prayer) DO UPDATE SET adhan = excluded.adhan, iqamah = excluded.iqamah`,
  ).run(mosqueId, date, prayer, adhan, iqamah);
}

/** All overrides from a date onwards (embedded into snapshots for offline extension). */
export function overridesFrom(db: DB, mosqueId: number, fromDate: string) {
  return db
    .prepare(
      'SELECT date, prayer, adhan, iqamah FROM prayer_overrides WHERE mosque_id = ? AND date >= ? ORDER BY date',
    )
    .all(mosqueId, fromDate) as {
    date: string;
    prayer: PrayerKey;
    adhan: string | null;
    iqamah: string | null;
  }[];
}

export function clearOverrides(db: DB, mosqueId: number, date: string): number {
  return db.prepare('DELETE FROM prayer_overrides WHERE mosque_id = ? AND date = ?').run(mosqueId, date)
    .changes;
}

/** Effective days from `fromDate` for `count` days (days without any schedule are skipped). */
export function getEffectiveRange(db: DB, mosqueId: number, fromDate: string, count: number): SnapshotDay[] {
  const out: SnapshotDay[] = [];
  for (let i = 0; i < count; i++) {
    const d = getEffectiveDay(db, mosqueId, addDays(fromDate, i));
    if (d) out.push(d);
  }
  return out;
}

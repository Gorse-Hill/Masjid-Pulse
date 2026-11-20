/**
 * Pure display logic shared by the server (snapshot generation, validation)
 * and the TV display app (bundled into public/tv/app.js by scripts/build-tv.mjs).
 * No Node or DOM dependencies allowed in this file.
 */

export const PRAYER_KEYS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;
export type PrayerKey = (typeof PRAYER_KEYS)[number];

export const PRAYER_NAMES: Record<PrayerKey, string> = {
  fajr: 'Fajr',
  dhuhr: 'Dhuhr',
  asr: 'Asr',
  maghrib: 'Maghrib',
  isha: 'Isha',
};

export interface SnapshotPrayer {
  key: PrayerKey;
  name: string;
  adhan: string; // HH:MM
  iqamah: string | null; // HH:MM
  overridden?: boolean;
  /** Day offset of the adhan relative to the day's date (1 = after midnight, -1 = evening before). */
  adhanDay?: number;
  /** Day offset of the iqamah relative to the day's date. */
  iqamahDay?: number;
}

export const CALC_METHOD_KEYS = [
  'MWL',
  'ISNA',
  'Egyptian',
  'UmmAlQura',
  'Karachi',
  'Dubai',
  'Qatar',
  'Kuwait',
  'Singapore',
  'Turkey',
  'Tehran',
  'NorthAmerica',
  'MoonsightingCommittee',
] as const;
export type CalcMethodKey = (typeof CALC_METHOD_KEYS)[number];
export const HIGH_LAT_RULES = ['auto', 'middleofthenight', 'seventhofthenight', 'twilightangle'] as const;
export type HighLatRuleKey = (typeof HIGH_LAT_RULES)[number];

export interface CalcSettings {
  latitude: number;
  longitude: number;
  timezone: string;
  method: CalcMethodKey;
  madhab: 'shafi' | 'hanafi';
  highLatitudeRule: HighLatRuleKey;
}

export interface IqamahRule {
  /** offset: N minutes after adhan; fixed: a clock time; none: no iqamah shown. */
  mode: 'offset' | 'fixed' | 'none';
  offsetMinutes?: number;
  fixedTime?: string | null;
  /** Round the computed iqamah to a multiple of this many minutes (0 = no rounding). */
  roundTo?: number;
  roundMode?: 'nearest' | 'up';
}
export type IqamahRules = Record<PrayerKey, IqamahRule>;

export interface SnapshotOverride {
  date: string;
  prayer: PrayerKey;
  adhan: string | null;
  iqamah: string | null;
}

/** Inputs embedded in a published snapshot so that days beyond the window can be generated
 * (by the TV while offline, or by the server's daily refresh) from approved data only. */
export interface SnapshotSource {
  mode: 'calculated' | 'manual';
  calc?: CalcSettings;
  rules?: IqamahRules;
  /** Manual mode: base times carried forward beyond the last day in the window. */
  manualBase?: { key: PrayerKey; adhan: string; iqamah: string | null }[];
  /** Published "today only" overrides from the publish date onwards. */
  overrides: SnapshotOverride[];
}

export interface SnapshotDay {
  date: string; // YYYY-MM-DD in mosque timezone
  prayers: SnapshotPrayer[];
}

export interface SnapshotJummah {
  label: string;
  khutbah: string;
  iqamah: string;
  language?: string | null;
}

export interface SnapshotAnnouncement {
  id: number;
  title: string;
  body: string;
  startDate: string;
  endDate: string;
}

export interface SnapshotSlide {
  id: number;
  url: string;
  caption: string | null;
  durationSec: number;
}

export interface SnapshotDonation {
  id: number;
  title: string;
  kind: 'donation' | 'fundraising' | 'payment';
  method: string | null;
  account: string | null;
  note: string | null;
}

export interface DisplaySnapshot {
  version: number;
  publishedAt: string; // ISO
  mosque: { id: number; name: string; city: string | null; timezone: string };
  days: SnapshotDay[];
  jummah: SnapshotJummah[];
  announcements: SnapshotAnnouncement[];
  slides: SnapshotSlide[];
  /** Optional so snapshots published before donations existed still render. */
  donations?: SnapshotDonation[];
  source?: SnapshotSource;
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidTime(value: unknown): value is string {
  return typeof value === 'string' && TIME_RE.test(value);
}

export function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** "HH:MM" -> minutes since midnight. Throws on invalid input. */
export function timeToMinutes(value: string): number {
  const m = TIME_RE.exec(value);
  if (!m) throw new Error(`Invalid time: ${value}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function minutesToTime(total: number): string {
  const t = ((Math.round(total) % 1440) + 1440) % 1440;
  const h = Math.floor(t / 60);
  const m = t % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Add whole days to a YYYY-MM-DD date string (calendar arithmetic, no timezone). */
export function addDays(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday ... 5 = Friday */
export function dayOfWeek(date: string): number {
  return new Date(date + 'T00:00:00Z').getUTCDay();
}

export interface LocalNow {
  date: string; // YYYY-MM-DD
  seconds: number; // seconds since local midnight
}

/** Current wall-clock date/time in an IANA timezone. */
export function localNow(timezone: string, now: Date = new Date()): LocalNow {
  // hour12:false (not hourCycle, which Chromium < 73 ignores, e.g. LG webOS 3-5 TVs). Some engines
  // render midnight as "24", hence the % 24.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts: Record<string, string> = {};
  if (typeof fmt.formatToParts === 'function') {
    for (const p of fmt.formatToParts(now)) parts[p.type] = p.value;
  } else {
    // formatToParts arrived in Chromium 57; older TV browsers get "MM/DD/YYYY, HH:MM:SS".
    const m = /(\d+)\D+(\d+)\D+(\d+)\D+(\d+):(\d+):(\d+)/.exec(fmt.format(now));
    if (!m) throw new Error('Unsupported Intl.DateTimeFormat output');
    [, parts.month, parts.day, parts.year, parts.hour, parts.minute, parts.second] = m;
  }
  const pad = (v: string) => (v.length < 2 ? '0' + v : v);
  const hour = Number(parts.hour) % 24;
  return {
    date: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
    seconds: hour * 3600 + Number(parts.minute) * 60 + Number(parts.second),
  };
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Absolute minutes from the day's midnight, honouring day offsets (may be <0 or >=1440). */
export function adhanAbsMinutes(p: { adhan: string; adhanDay?: number }): number {
  return timeToMinutes(p.adhan) + 1440 * (p.adhanDay ?? 0);
}
export function iqamahAbsMinutes(p: { iqamah: string | null; iqamahDay?: number }): number | null {
  return p.iqamah ? timeToMinutes(p.iqamah) + 1440 * (p.iqamahDay ?? 0) : null;
}

/**
 * Validate a full day of prayer times. Returns a list of human readable errors (empty = valid).
 * Rules: every adhan must be HH:MM; iqamah optional but must be >= adhan;
 * adhan times must be in ascending order Fajr < Dhuhr < Asr < Maghrib < Isha.
 */
export function validateDay(
  prayers: { key: PrayerKey; adhan: string; iqamah: string | null; adhanDay?: number; iqamahDay?: number }[],
): string[] {
  const errors: string[] = [];
  let prev = -1;
  for (const p of prayers) {
    if (!isValidTime(p.adhan)) {
      errors.push(`${PRAYER_NAMES[p.key]} adhan must be HH:MM`);
      continue;
    }
    const a = timeToMinutes(p.adhan) + 1440 * (p.adhanDay ?? 0);
    if (p.iqamah !== null && p.iqamah !== undefined) {
      if (!isValidTime(p.iqamah)) errors.push(`${PRAYER_NAMES[p.key]} iqamah must be HH:MM`);
      else if (timeToMinutes(p.iqamah) + 1440 * (p.iqamahDay ?? 0) < a)
        errors.push(`${PRAYER_NAMES[p.key]} iqamah is before adhan`);
    }
    if (a <= prev) errors.push(`${PRAYER_NAMES[p.key]} adhan must be after the previous prayer`);
    prev = a;
  }
  return errors;
}

/** Announcement is visible on a given local date if startDate <= date <= endDate (inclusive). */
export function isAnnouncementActive(a: { startDate: string; endDate: string }, date: string): boolean {
  return a.startDate <= date && date <= a.endDate;
}

export function activeAnnouncements<T extends { startDate: string; endDate: string }>(
  list: T[],
  date: string,
): T[] {
  return list.filter((a) => isAnnouncementActive(a, date));
}

/**
 * Returns the prayers to display for a day. On Fridays, if a Jummah schedule exists,
 * Dhuhr is shown as Jumu'ah with the first Jummah iqamah.
 */
export function displayPrayersForDay(day: SnapshotDay, jummah: SnapshotJummah[]): SnapshotPrayer[] {
  if (dayOfWeek(day.date) !== 5 || jummah.length === 0) return day.prayers;
  return day.prayers.map((p) =>
    p.key === 'dhuhr' ? { ...p, name: "Jumu'ah", adhan: jummah[0].khutbah, iqamah: jummah[0].iqamah } : p,
  );
}

export type NextEventType = 'adhan' | 'iqamah';

export interface NextEvent {
  type: NextEventType;
  prayer: SnapshotPrayer;
  date: string;
  at: string; // HH:MM
  secondsUntil: number;
}

/** Find the day entry for a date; returns undefined if not in snapshot. */
export function findDay(days: SnapshotDay[], date: string): SnapshotDay | undefined {
  return days.find((d) => d.date === date);
}

/**
 * Compute the next upcoming event (adhan or iqamah) from "now".
 * - Before a prayer's adhan -> next event is that adhan.
 * - Between adhan and iqamah -> next event is the iqamah (iqamah countdown).
 * - After Isha's iqamah -> tomorrow's Fajr adhan (if tomorrow is in the snapshot).
 * Returns null when no further data is available (e.g. snapshot is stale).
 */
export function computeNextEvent(
  days: SnapshotDay[],
  jummah: SnapshotJummah[],
  now: LocalNow,
): NextEvent | null {
  // Start from yesterday: its Isha (or iqamah) may fall after midnight, i.e. still ahead of "now".
  for (let offset = -1; offset <= 1; offset++) {
    const date = addDays(now.date, offset);
    const day = findDay(days, date);
    if (!day) continue;
    const base = offset * 86400;
    for (const p of displayPrayersForDay(day, jummah)) {
      const adhanSec = base + adhanAbsMinutes(p) * 60;
      if (now.seconds < adhanSec) {
        return { type: 'adhan', prayer: p, date, at: p.adhan, secondsUntil: adhanSec - now.seconds };
      }
      if (p.iqamah) {
        const iqSec = base + iqamahAbsMinutes(p)! * 60;
        if (now.seconds < iqSec) {
          return { type: 'iqamah', prayer: p, date, at: p.iqamah, secondsUntil: iqSec - now.seconds };
        }
      }
    }
  }
  return null;
}

/** The prayer whose time has most recently started today (for highlighting), or null before Fajr. */
export function currentPrayer(
  days: SnapshotDay[],
  jummah: SnapshotJummah[],
  now: LocalNow,
): PrayerKey | null {
  const day = findDay(days, now.date);
  if (!day) return null;
  let current: PrayerKey | null = null;
  for (const p of displayPrayersForDay(day, jummah)) {
    if (adhanAbsMinutes(p) * 60 <= now.seconds) current = p.key;
  }
  return current;
}

/** Format seconds as H:MM:SS or MM:SS. */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Human-friendly "last updated" age, e.g. "just now", "5 min ago", "3 h ago", "2 days ago". */
export function formatAge(fromIso: string, now: Date = new Date()): string {
  const diff = Math.max(0, Math.floor((now.getTime() - new Date(fromIso).getTime()) / 1000));
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  const d = Math.floor(diff / 86400);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

/** Combined rotation list for the TV: announcements active today, donations, then slides. */
export type RotationItem =
  | { kind: 'announcement'; item: SnapshotAnnouncement; durationSec: number }
  | { kind: 'donation'; item: SnapshotDonation; durationSec: number }
  | { kind: 'slide'; item: SnapshotSlide; durationSec: number };

export function buildRotation(snapshot: DisplaySnapshot, date: string): RotationItem[] {
  const items: RotationItem[] = [];
  for (const a of activeAnnouncements(snapshot.announcements, date)) {
    items.push({ kind: 'announcement', item: a, durationSec: 12 });
  }
  for (const d of snapshot.donations ?? []) {
    items.push({ kind: 'donation', item: d, durationSec: 14 });
  }
  for (const s of snapshot.slides) {
    items.push({ kind: 'slide', item: s, durationSec: s.durationSec });
  }
  return items;
}

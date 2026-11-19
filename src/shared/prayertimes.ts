/**
 * Automatic prayer time calculation (adhan-js) + iqamah rules. Pure: shared by the server
 * (snapshot generation, preview) and the TV app (extending a cached snapshot while offline).
 */
import {
  CalculationMethod,
  Coordinates,
  HighLatitudeRule,
  Madhab,
  PolarCircleResolution,
  PrayerTimes,
} from 'adhan';
import {
  type CalcMethodKey,
  type CalcSettings,
  type DisplaySnapshot,
  type IqamahRule,
  type IqamahRules,
  PRAYER_KEYS,
  PRAYER_NAMES,
  type PrayerKey,
  type SnapshotDay,
  type SnapshotOverride,
  type SnapshotPrayer,
  addDays,
  localNow,
  minutesToTime,
  timeToMinutes,
} from './display.js';

const METHOD_FACTORIES: Record<CalcMethodKey, () => ReturnType<typeof CalculationMethod.MuslimWorldLeague>> =
  {
    MWL: CalculationMethod.MuslimWorldLeague,
    // adhan-js implements ISNA as "NorthAmerica" (Fajr 15°, Isha 15°); both keys map to it.
    ISNA: CalculationMethod.NorthAmerica,
    NorthAmerica: CalculationMethod.NorthAmerica,
    Egyptian: CalculationMethod.Egyptian,
    UmmAlQura: CalculationMethod.UmmAlQura,
    Karachi: CalculationMethod.Karachi,
    Dubai: CalculationMethod.Dubai,
    Qatar: CalculationMethod.Qatar,
    Kuwait: CalculationMethod.Kuwait,
    Singapore: CalculationMethod.Singapore,
    Turkey: CalculationMethod.Turkey,
    Tehran: CalculationMethod.Tehran,
    MoonsightingCommittee: CalculationMethod.MoonsightingCommittee,
  };

export const CALC_METHOD_LABELS: Record<CalcMethodKey, string> = {
  MWL: 'Muslim World League',
  ISNA: 'ISNA (Islamic Society of North America)',
  Egyptian: 'Egyptian General Authority of Survey',
  UmmAlQura: 'Umm al-Qura, Makkah',
  Karachi: 'University of Islamic Sciences, Karachi',
  Dubai: 'Dubai',
  Qatar: 'Qatar',
  Kuwait: 'Kuwait',
  Singapore: 'Singapore',
  Turkey: 'Diyanet, Turkey',
  Tehran: 'Institute of Geophysics, Tehran',
  NorthAmerica: 'North America (same angles as ISNA)',
  MoonsightingCommittee: 'Moonsighting Committee Worldwide',
};

export const DEFAULT_IQAMAH_RULES: IqamahRules = {
  fajr: { mode: 'offset', offsetMinutes: 20, roundTo: 5, roundMode: 'up' },
  dhuhr: { mode: 'offset', offsetMinutes: 15, roundTo: 5, roundMode: 'up' },
  asr: { mode: 'offset', offsetMinutes: 15, roundTo: 5, roundMode: 'up' },
  maghrib: { mode: 'offset', offsetMinutes: 7, roundTo: 0 },
  isha: { mode: 'offset', offsetMinutes: 15, roundTo: 5, roundMode: 'up' },
};

/** If a fixed iqamah would be before the adhan (e.g. summer Isha), use adhan + this many minutes. */
export const FIXED_FALLBACK_OFFSET = 10;

function toDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  // adhan-js only reads the local Y/M/D of this Date; the returned prayer instants are absolute.
  return new Date(y, m - 1, d);
}

export interface ComputedAdhan {
  key: PrayerKey | 'sunrise';
  /** Absolute minutes from local midnight of `date` in the mosque timezone (may be >=1440 or <0). */
  minutes: number;
}

/** Compute adhan times (+ sunrise) for a local date in the mosque's timezone. */
export function computeAdhan(settings: CalcSettings, date: string): ComputedAdhan[] {
  const coords = new Coordinates(settings.latitude, settings.longitude);
  const params = METHOD_FACTORIES[settings.method]();
  params.madhab = settings.madhab === 'hanafi' ? Madhab.Hanafi : Madhab.Shafi;
  params.highLatitudeRule =
    settings.highLatitudeRule === 'auto'
      ? HighLatitudeRule.recommended(coords)
      : (settings.highLatitudeRule as typeof params.highLatitudeRule);
  // Inside the polar circle use the closest day on which the times can be computed.
  params.polarCircleResolution = PolarCircleResolution.AqrabYaum;
  const times = new PrayerTimes(coords, toDate(date), params);
  const keys = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;
  return keys.map((key) => {
    const instant = times[key];
    if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
      throw new Error(`Cannot compute ${key} for ${date} at this location`);
    }
    const local = localNow(settings.timezone, instant);
    const dayDiff = Math.round(
      (Date.parse(local.date + 'T00:00:00Z') - Date.parse(date + 'T00:00:00Z')) / 86400000,
    );
    return { key, minutes: dayDiff * 1440 + Math.floor(local.seconds / 60) };
  });
}

function roundMinutes(value: number, step: number, mode: 'nearest' | 'up'): number {
  if (!step || step <= 1) return value;
  return mode === 'up' ? Math.ceil(value / step) * step : Math.round(value / step) * step;
}

/**
 * Apply an iqamah rule to an adhan (absolute minutes). Returns absolute minutes or null.
 * The result is never before the adhan.
 */
export function applyIqamahRule(adhanMinutes: number, rule: IqamahRule): number | null {
  if (rule.mode === 'none') return null;
  const step = rule.roundTo ?? 0;
  const mode = rule.roundMode ?? 'nearest';
  if (rule.mode === 'fixed' && rule.fixedTime) {
    const fixed = timeToMinutes(rule.fixedTime) + 1440 * Math.floor(adhanMinutes / 1440);
    if (fixed >= adhanMinutes) return fixed;
    return roundMinutes(adhanMinutes + FIXED_FALLBACK_OFFSET, step, 'up');
  }
  const raw = adhanMinutes + Math.max(0, rule.offsetMinutes ?? 0);
  const rounded = roundMinutes(raw, step, mode);
  return rounded < adhanMinutes ? roundMinutes(raw, step, 'up') : rounded;
}

function split(abs: number): { time: string; day: number } {
  return { time: minutesToTime(abs), day: Math.floor(abs / 1440) };
}

function withTimes(
  key: PrayerKey,
  adhanAbs: number,
  iqamahAbs: number | null,
  overridden: boolean,
): SnapshotPrayer {
  const a = split(adhanAbs);
  const p: SnapshotPrayer = { key, name: PRAYER_NAMES[key], adhan: a.time, iqamah: null };
  if (a.day) p.adhanDay = a.day;
  if (iqamahAbs !== null) {
    const i = split(iqamahAbs);
    p.iqamah = i.time;
    if (i.day) p.iqamahDay = i.day;
  }
  if (overridden) p.overridden = true;
  return p;
}

/**
 * Effective calculated day. Precedence per prayer:
 *   adhan:  "today only" adhan override > calculated adhan
 *   iqamah: "today only" iqamah override > iqamah rule applied to the (possibly overridden) adhan
 */
export function computeDay(
  settings: CalcSettings,
  rules: IqamahRules,
  date: string,
  overrides: Pick<SnapshotOverride, 'prayer' | 'adhan' | 'iqamah'>[] = [],
): SnapshotDay & { sunrise: string } {
  const computed = computeAdhan(settings, date);
  const byKey = new Map(computed.map((c) => [c.key, c.minutes]));
  const ov = new Map(overrides.map((o) => [o.prayer, o]));
  const prayers = PRAYER_KEYS.map((key) => {
    const o = ov.get(key);
    const adhanAbs = o?.adhan ? timeToMinutes(o.adhan) : byKey.get(key)!;
    const iqamahAbs = o?.iqamah ? timeToMinutes(o.iqamah) : applyIqamahRule(adhanAbs, rules[key]);
    return withTimes(key, adhanAbs, iqamahAbs, !!o);
  });
  return { date, sunrise: minutesToTime(byKey.get('sunrise')!), prayers };
}

/** Manual-mode day from base times + overrides. */
export function manualDay(
  date: string,
  base: { key: PrayerKey; adhan: string; iqamah: string | null }[],
  overrides: Pick<SnapshotOverride, 'prayer' | 'adhan' | 'iqamah'>[] = [],
): SnapshotDay {
  const ov = new Map(overrides.map((o) => [o.prayer, o]));
  return {
    date,
    prayers: base.map((b) => {
      const o = ov.get(b.key);
      return {
        key: b.key,
        name: PRAYER_NAMES[b.key],
        adhan: o?.adhan ?? b.adhan,
        iqamah: o?.iqamah ?? b.iqamah,
        ...(o ? { overridden: true } : {}),
      };
    }),
  };
}

/**
 * Days for the given dates from a published snapshot: days already in the snapshot are used
 * as-is; missing days are generated from the snapshot's embedded source (calculation settings or
 * manual base times + published overrides). Used by the TV offline and by the server refresh.
 */
export function snapshotDaysFor(
  snapshot: Pick<DisplaySnapshot, 'days' | 'source'>,
  dates: string[],
): SnapshotDay[] {
  const out: SnapshotDay[] = [];
  for (const date of dates) {
    const existing = snapshot.days.find((d) => d.date === date);
    if (existing) {
      out.push(existing);
      continue;
    }
    const src = snapshot.source;
    if (!src) continue;
    const ov = src.overrides.filter((o) => o.date === date);
    try {
      if (src.mode === 'calculated' && src.calc && src.rules) {
        const { sunrise: _sunrise, ...day } = computeDay(src.calc, src.rules, date, ov);
        out.push(day);
      } else if (src.manualBase && date > (snapshot.days[snapshot.days.length - 1]?.date ?? '')) {
        out.push(manualDay(date, src.manualBase, ov));
      }
    } catch {
      // cannot compute for this date (should not happen with polar resolution) - skip
    }
  }
  return out;
}

/** Convenience: yesterday, today, tomorrow (and more) around a date. */
export function datesAround(date: string, before: number, after: number): string[] {
  const out: string[] = [];
  for (let i = -before; i <= after; i++) out.push(addDays(date, i));
  return out;
}

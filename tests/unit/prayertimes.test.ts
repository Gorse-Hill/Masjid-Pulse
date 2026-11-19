import { describe, expect, it } from 'vitest';
import {
  type CalcSettings,
  type DisplaySnapshot,
  type IqamahRules,
  computeNextEvent,
  currentPrayer,
  timeToMinutes,
  validateDay,
} from '../../src/shared/display.js';
import {
  DEFAULT_IQAMAH_RULES,
  applyIqamahRule,
  computeAdhan,
  computeDay,
  datesAround,
  manualDay,
  snapshotDaysFor,
} from '../../src/shared/prayertimes.js';

/**
 * Reference times fetched on 2026-10-11 from the independent AlAdhan API
 * (api.aladhan.com/v1/timings, school=0, latitudeAdjustmentMethod=3 "angle based" unless noted).
 * AlAdhan uses a different implementation than adhan-js, so agreement within ±2 min is a real check.
 * Asr is excluded for Fort McMurray in March: the two implementations differ by 3 min there.
 */
const MECCA = { latitude: 21.4225, longitude: 39.8262, timezone: 'Asia/Riyadh' };
const LONDON = { latitude: 51.5074, longitude: -0.1278, timezone: 'Europe/London' };
const FORT_MCMURRAY = { latitude: 56.7267, longitude: -111.381, timezone: 'America/Edmonton' };

type Ref = Partial<Record<'fajr' | 'sunrise' | 'dhuhr' | 'asr' | 'maghrib' | 'isha', string>>;
const CASES: { name: string; settings: CalcSettings; date: string; ref: Ref; nextDay?: string[] }[] = [
  {
    name: 'Mecca, Umm al-Qura',
    settings: { ...MECCA, method: 'UmmAlQura', madhab: 'shafi', highLatitudeRule: 'twilightangle' },
    date: '2026-10-11',
    ref: { fajr: '04:59', sunrise: '06:15', dhuhr: '12:07', asr: '15:29', maghrib: '18:00', isha: '19:30' },
  },
  {
    name: 'London, MWL',
    settings: { ...LONDON, method: 'MWL', madhab: 'shafi', highLatitudeRule: 'twilightangle' },
    date: '2026-10-11',
    ref: { fajr: '05:26', sunrise: '07:18', dhuhr: '12:47', asr: '15:40', maghrib: '18:16', isha: '20:00' },
  },
  {
    name: 'London, day before BST ends',
    settings: { ...LONDON, method: 'MWL', madhab: 'shafi', highLatitudeRule: 'twilightangle' },
    date: '2026-10-24',
    ref: { fajr: '05:48', sunrise: '07:40', dhuhr: '12:45', asr: '15:19', maghrib: '17:49', isha: '19:34' },
  },
  {
    name: 'London, day after BST ends (clocks back 1h)',
    settings: { ...LONDON, method: 'MWL', madhab: 'shafi', highLatitudeRule: 'twilightangle' },
    date: '2026-10-26',
    ref: { fajr: '04:51', sunrise: '06:43', dhuhr: '11:44', asr: '14:16', maghrib: '16:45', isha: '18:31' },
  },
  {
    name: 'London, midsummer (high latitude, twilight angle)',
    settings: { ...LONDON, method: 'MWL', madhab: 'shafi', highLatitudeRule: 'twilightangle' },
    date: '2026-06-21',
    ref: { fajr: '02:31', sunrise: '04:43', dhuhr: '13:02', asr: '17:25', maghrib: '21:22', isha: '23:27' },
  },
  {
    name: 'Fort McMurray AB, ISNA, midsummer (twilight angle)',
    settings: { ...FORT_MCMURRAY, method: 'ISNA', madhab: 'shafi', highLatitudeRule: 'twilightangle' },
    date: '2026-06-21',
    ref: { fajr: '03:00', sunrise: '04:33', dhuhr: '13:27', asr: '18:02', maghrib: '22:22', isha: '23:55' },
  },
  {
    name: 'Fort McMurray AB, ISNA, midsummer (middle of the night -> Isha after midnight)',
    settings: { ...FORT_MCMURRAY, method: 'ISNA', madhab: 'shafi', highLatitudeRule: 'middleofthenight' },
    date: '2026-06-21',
    ref: { fajr: '01:27', sunrise: '04:33', dhuhr: '13:27', asr: '18:02', maghrib: '22:22', isha: '01:27' },
    nextDay: ['isha'],
  },
  {
    name: 'Fort McMurray AB, DST start day (2026-03-08)',
    settings: { ...FORT_MCMURRAY, method: 'ISNA', madhab: 'shafi', highLatitudeRule: 'twilightangle' },
    date: '2026-03-08',
    ref: { fajr: '06:15', sunrise: '07:59', dhuhr: '13:36', maghrib: '19:14', isha: '20:59' },
  },
];

describe('adhan-js calculation vs independent reference times (±2 min)', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const out = computeAdhan(c.settings, c.date);
      for (const [key, ref] of Object.entries(c.ref)) {
        const got = out.find((o) => o.key === key)!;
        const nextDay = c.nextDay?.includes(key) ? 1440 : 0;
        expect(Math.abs(got.minutes - (timeToMinutes(ref) + nextDay)), `${key}`).toBeLessThanOrEqual(2);
      }
    });
  }

  it('DST: London Dhuhr moves ~1 hour earlier on the clock across the October change', () => {
    const s: CalcSettings = { ...LONDON, method: 'MWL', madhab: 'shafi', highLatitudeRule: 'twilightangle' };
    const before = computeAdhan(s, '2026-10-24').find((x) => x.key === 'dhuhr')!.minutes;
    const after = computeAdhan(s, '2026-10-26').find((x) => x.key === 'dhuhr')!.minutes;
    expect(before - after).toBeGreaterThanOrEqual(59);
    expect(before - after).toBeLessThanOrEqual(62);
  });

  it('Hanafi Asr is later than Shafi Asr', () => {
    const base: CalcSettings = {
      ...LONDON,
      method: 'MWL',
      madhab: 'shafi',
      highLatitudeRule: 'twilightangle',
    };
    const shafi = computeAdhan(base, '2026-10-11').find((x) => x.key === 'asr')!.minutes;
    const hanafi = computeAdhan({ ...base, madhab: 'hanafi' }, '2026-10-11').find(
      (x) => x.key === 'asr',
    )!.minutes;
    expect(hanafi - shafi).toBeGreaterThan(30);
  });

  it('every supported method computes a valid, ordered day', () => {
    for (const method of [
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
    ] as const) {
      const day = computeDay(
        { ...MECCA, method, madhab: 'shafi', highLatitudeRule: 'auto' },
        DEFAULT_IQAMAH_RULES,
        '2026-10-11',
      );
      expect(validateDay(day.prayers), method).toEqual([]);
    }
  });

  it('polar region (Tromsø, midsummer) still yields times via closest-day resolution', () => {
    const day = computeDay(
      {
        latitude: 69.6492,
        longitude: 18.9553,
        timezone: 'Europe/Oslo',
        method: 'MWL',
        madhab: 'shafi',
        highLatitudeRule: 'auto',
      },
      DEFAULT_IQAMAH_RULES,
      '2026-06-21',
    );
    expect(day.prayers).toHaveLength(5);
  });
});

describe('iqamah rules', () => {
  const a = timeToMinutes('13:02');
  it('offset with rounding up to 5 minutes', () => {
    expect(applyIqamahRule(a, { mode: 'offset', offsetMinutes: 10, roundTo: 5, roundMode: 'up' })).toBe(
      timeToMinutes('13:15'),
    );
  });
  it('offset with nearest rounding never goes before the adhan', () => {
    expect(applyIqamahRule(a, { mode: 'offset', offsetMinutes: 10, roundTo: 5, roundMode: 'nearest' })).toBe(
      timeToMinutes('13:10'),
    );
    expect(applyIqamahRule(a, { mode: 'offset', offsetMinutes: 0, roundTo: 15, roundMode: 'nearest' })).toBe(
      timeToMinutes('13:15'),
    );
  });
  it('offset without rounding', () => {
    expect(applyIqamahRule(timeToMinutes('18:03'), { mode: 'offset', offsetMinutes: 7 })).toBe(
      timeToMinutes('18:10'),
    );
  });
  it('fixed clock time, with fallback when the adhan is later than the fixed time', () => {
    expect(applyIqamahRule(a, { mode: 'fixed', fixedTime: '13:30' })).toBe(timeToMinutes('13:30'));
    expect(applyIqamahRule(timeToMinutes('21:47'), { mode: 'fixed', fixedTime: '20:00', roundTo: 5 })).toBe(
      timeToMinutes('22:00'),
    );
  });
  it('none -> no iqamah', () => {
    expect(applyIqamahRule(a, { mode: 'none' })).toBeNull();
  });
  it('iqamah after midnight gets a next-day flag', () => {
    const day = computeDay(
      { ...FORT_MCMURRAY, method: 'ISNA', madhab: 'shafi', highLatitudeRule: 'middleofthenight' },
      DEFAULT_IQAMAH_RULES,
      '2026-06-21',
    );
    const isha = day.prayers.find((p) => p.key === 'isha')!;
    expect(isha).toMatchObject({ adhanDay: 1, iqamahDay: 1 });
    expect(validateDay(day.prayers)).toEqual([]);
  });
});

describe('override precedence', () => {
  const settings: CalcSettings = {
    ...LONDON,
    method: 'MWL',
    madhab: 'shafi',
    highLatitudeRule: 'twilightangle',
  };
  const rules: IqamahRules = {
    ...DEFAULT_IQAMAH_RULES,
    dhuhr: { mode: 'offset', offsetMinutes: 10, roundTo: 0 },
  };
  it('iqamah override beats the rule', () => {
    const day = computeDay(settings, rules, '2026-10-11', [
      { prayer: 'dhuhr', adhan: null, iqamah: '13:30' },
    ]);
    expect(day.prayers[1]).toMatchObject({ iqamah: '13:30', overridden: true });
  });
  it('adhan override re-applies the iqamah rule to the overridden adhan', () => {
    const day = computeDay(settings, rules, '2026-10-11', [
      { prayer: 'dhuhr', adhan: '13:15', iqamah: null },
    ]);
    expect(day.prayers[1]).toMatchObject({ adhan: '13:15', iqamah: '13:25', overridden: true });
  });
  it('manual mode: override beats base times', () => {
    const base = [{ key: 'fajr' as const, adhan: '05:00', iqamah: '05:30' }];
    expect(
      manualDay('2026-10-11', base, [{ prayer: 'fajr', adhan: null, iqamah: '05:40' }]).prayers[0],
    ).toMatchObject({
      adhan: '05:00',
      iqamah: '05:40',
      overridden: true,
    });
  });
});

describe('countdown with Isha after midnight', () => {
  const settings: CalcSettings = {
    ...FORT_MCMURRAY,
    method: 'ISNA',
    madhab: 'shafi',
    highLatitudeRule: 'middleofthenight',
  };
  const days = ['2026-06-21', '2026-06-22'].map((d) => computeDay(settings, DEFAULT_IQAMAH_RULES, d));
  it("at 00:30 on the 22nd the next event is the 21st's Isha (after midnight), not Fajr", () => {
    const e = computeNextEvent(days, [], { date: '2026-06-22', seconds: 30 * 60 });
    expect(e).toMatchObject({ type: 'adhan', date: '2026-06-21' });
    expect(e!.prayer.key).toBe('isha');
    expect(e!.secondsUntil).toBeGreaterThan(50 * 60);
    expect(currentPrayer(days, [], { date: '2026-06-21', seconds: 23 * 3600 })).toBe('maghrib');
  });
});

describe('snapshot day extension (offline TV + daily refresh)', () => {
  const settings: CalcSettings = { ...MECCA, method: 'UmmAlQura', madhab: 'shafi', highLatitudeRule: 'auto' };
  it('calculated: generates missing days from embedded settings and applies published overrides', () => {
    const snap: Pick<DisplaySnapshot, 'days' | 'source'> = {
      days: [computeDay(settings, DEFAULT_IQAMAH_RULES, '2026-10-11')],
      source: {
        mode: 'calculated',
        calc: settings,
        rules: DEFAULT_IQAMAH_RULES,
        overrides: [{ date: '2026-10-30', prayer: 'isha', adhan: null, iqamah: '21:00' }],
      },
    };
    const out = snapshotDaysFor(snap, datesAround('2026-10-29', 0, 2));
    expect(out.map((d) => d.date)).toEqual(['2026-10-29', '2026-10-30', '2026-10-31']);
    expect(out[1].prayers[4]).toMatchObject({ iqamah: '21:00', overridden: true });
    expect(out[0].prayers[4].overridden).toBeUndefined();
  });
  it('manual: carries the base forward after the last day only; legacy snapshots yield nothing new', () => {
    const base = [{ key: 'fajr' as const, adhan: '05:00', iqamah: '05:30' }];
    const snap: Pick<DisplaySnapshot, 'days' | 'source'> = {
      days: [manualDay('2026-10-11', base)],
      source: { mode: 'manual', manualBase: base, overrides: [] },
    };
    expect(snapshotDaysFor(snap, ['2026-10-10', '2026-10-11', '2026-10-12']).map((d) => d.date)).toEqual([
      '2026-10-11',
      '2026-10-12',
    ]);
    expect(snapshotDaysFor({ days: [] }, ['2026-10-12'])).toEqual([]);
  });
});

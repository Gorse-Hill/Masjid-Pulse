import { describe, expect, it } from 'vitest';
import {
  type DisplaySnapshot,
  type SnapshotDay,
  type SnapshotJummah,
  activeAnnouncements,
  addDays,
  buildRotation,
  computeNextEvent,
  currentPrayer,
  dayOfWeek,
  displayPrayersForDay,
  formatAge,
  formatCountdown,
  isAnnouncementActive,
  isValidDate,
  isValidTime,
  isValidTimezone,
  localNow,
  minutesToTime,
  timeToMinutes,
  validateDay,
} from '../../src/shared/display.js';

const day = (date: string): SnapshotDay => ({
  date,
  prayers: [
    { key: 'fajr', name: 'Fajr', adhan: '05:00', iqamah: '05:30' },
    { key: 'dhuhr', name: 'Dhuhr', adhan: '12:30', iqamah: '13:00' },
    { key: 'asr', name: 'Asr', adhan: '15:45', iqamah: '16:00' },
    { key: 'maghrib', name: 'Maghrib', adhan: '18:05', iqamah: null },
    { key: 'isha', name: 'Isha', adhan: '19:30', iqamah: '19:45' },
  ],
});
const at = (date: string, hhmm: string, sec = 0) => ({ date, seconds: timeToMinutes(hhmm) * 60 + sec });
const days = [day('2026-10-11'), day('2026-10-12')]; // Sunday, Monday

describe('time & date helpers', () => {
  it('validates HH:MM times', () => {
    expect(isValidTime('00:00')).toBe(true);
    expect(isValidTime('23:59')).toBe(true);
    expect(isValidTime('24:00')).toBe(false);
    expect(isValidTime('7:30')).toBe(false);
    expect(isValidTime(730)).toBe(false);
  });
  it('validates calendar dates', () => {
    expect(isValidDate('2026-02-28')).toBe(true);
    expect(isValidDate('2026-02-30')).toBe(false);
    expect(isValidDate('2026-2-3')).toBe(false);
  });
  it('converts times and does date arithmetic across month/year ends', () => {
    expect(timeToMinutes('13:05')).toBe(785);
    expect(() => timeToMinutes('bad')).toThrow();
    expect(minutesToTime(785)).toBe('13:05');
    expect(minutesToTime(1440 + 5)).toBe('00:05');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(dayOfWeek('2026-10-16')).toBe(5); // Friday
  });
  it('computes local wall-clock time in a timezone', () => {
    const instant = new Date('2026-10-11T21:30:15Z');
    expect(localNow('Africa/Mogadishu', instant)).toEqual({ date: '2026-10-12', seconds: 30 * 60 + 15 });
    expect(localNow('UTC', instant)).toEqual({ date: '2026-10-11', seconds: 21 * 3600 + 30 * 60 + 15 });
    expect(isValidTimezone('Europe/London')).toBe(true);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
  });
});

describe('validateDay', () => {
  it('accepts a valid day', () => {
    expect(validateDay(day('2026-10-11').prayers)).toEqual([]);
  });
  it('rejects iqamah before adhan', () => {
    const p = day('2026-10-11').prayers.map((x) => (x.key === 'asr' ? { ...x, iqamah: '15:00' } : x));
    expect(validateDay(p)).toContain('Asr iqamah is before adhan');
  });
  it('rejects out-of-order prayers and malformed times', () => {
    const p = day('2026-10-11').prayers.map((x) =>
      x.key === 'dhuhr' ? { ...x, adhan: '04:00', iqamah: null } : x,
    );
    expect(validateDay(p)).toContain('Dhuhr adhan must be after the previous prayer');
    const bad = day('2026-10-11').prayers.map((x) => (x.key === 'isha' ? { ...x, adhan: '7pm' } : x));
    expect(validateDay(bad)).toContain('Isha adhan must be HH:MM');
  });
});

describe('next prayer / iqamah countdown', () => {
  it('before Fajr counts down to Fajr adhan', () => {
    const e = computeNextEvent(days, [], at('2026-10-11', '04:00'));
    expect(e).toMatchObject({ type: 'adhan', at: '05:00', secondsUntil: 3600 });
    expect(e!.prayer.key).toBe('fajr');
  });
  it('between adhan and iqamah counts down to iqamah', () => {
    const e = computeNextEvent(days, [], at('2026-10-11', '12:45', 30));
    expect(e).toMatchObject({ type: 'iqamah', at: '13:00', secondsUntil: 14 * 60 + 30 });
    expect(e!.prayer.key).toBe('dhuhr');
  });
  it('exactly at adhan switches to the iqamah countdown', () => {
    const e = computeNextEvent(days, [], at('2026-10-11', '15:45'));
    expect(e).toMatchObject({ type: 'iqamah', secondsUntil: 15 * 60 });
  });
  it('skips iqamah countdown when iqamah is not set', () => {
    const e = computeNextEvent(days, [], at('2026-10-11', '18:06'));
    expect(e).toMatchObject({ type: 'adhan', at: '19:30' });
    expect(e!.prayer.key).toBe('isha');
  });
  it('after Isha iqamah rolls over to tomorrow Fajr', () => {
    const e = computeNextEvent(days, [], at('2026-10-11', '22:00'));
    expect(e).toMatchObject({
      type: 'adhan',
      date: '2026-10-12',
      at: '05:00',
      secondsUntil: 2 * 3600 + 5 * 3600,
    });
  });
  it('returns null when the snapshot has no data for today or tomorrow', () => {
    expect(computeNextEvent(days, [], at('2026-11-30', '10:00'))).toBeNull();
    expect(computeNextEvent([day('2026-10-11')], [], at('2026-10-11', '23:00'))).toBeNull();
  });
  it('highlights the current prayer', () => {
    expect(currentPrayer(days, [], at('2026-10-11', '04:00'))).toBeNull();
    expect(currentPrayer(days, [], at('2026-10-11', '16:30'))).toBe('asr');
    expect(currentPrayer(days, [], at('2026-11-30', '16:30'))).toBeNull();
  });
});

describe('Jummah on Friday', () => {
  const jummah: SnapshotJummah[] = [{ label: '1st', khutbah: '12:45', iqamah: '13:15' }];
  it("replaces Dhuhr with Jumu'ah on Fridays only", () => {
    const fri = displayPrayersForDay(day('2026-10-16'), jummah);
    expect(fri[1]).toMatchObject({ key: 'dhuhr', name: "Jumu'ah", adhan: '12:45', iqamah: '13:15' });
    expect(displayPrayersForDay(day('2026-10-15'), jummah)[1].name).toBe('Dhuhr');
    expect(displayPrayersForDay(day('2026-10-16'), [])[1].name).toBe('Dhuhr');
  });
  it('countdown uses Jummah iqamah on Friday', () => {
    const e = computeNextEvent([day('2026-10-16')], jummah, at('2026-10-16', '13:00'));
    expect(e).toMatchObject({ type: 'iqamah', at: '13:15', secondsUntil: 15 * 60 });
  });
});

describe('announcement expiry', () => {
  const a = { startDate: '2026-10-10', endDate: '2026-10-12' };
  it('is active inclusively between start and end date', () => {
    expect(isAnnouncementActive(a, '2026-10-09')).toBe(false);
    expect(isAnnouncementActive(a, '2026-10-10')).toBe(true);
    expect(isAnnouncementActive(a, '2026-10-12')).toBe(true);
    expect(isAnnouncementActive(a, '2026-10-13')).toBe(false);
  });
  it('filters expired and future announcements', () => {
    const list = [
      a,
      { startDate: '2026-10-01', endDate: '2026-10-05' },
      { startDate: '2026-10-20', endDate: '2026-10-21' },
    ];
    expect(activeAnnouncements(list, '2026-10-11')).toEqual([a]);
  });
});

describe('formatting & rotation', () => {
  it('formats countdowns', () => {
    expect(formatCountdown(65)).toBe('01:05');
    expect(formatCountdown(3 * 3600 + 7)).toBe('3:00:07');
    expect(formatCountdown(-5)).toBe('00:00');
  });
  it('formats last-updated age', () => {
    const now = new Date('2026-10-11T12:00:00Z');
    expect(formatAge('2026-10-11T11:59:30Z', now)).toBe('just now');
    expect(formatAge('2026-10-11T11:55:00Z', now)).toBe('5 min ago');
    expect(formatAge('2026-10-11T09:00:00Z', now)).toBe('3 h ago');
    expect(formatAge('2026-10-10T12:00:00Z', now)).toBe('1 day ago');
    expect(formatAge('2026-10-08T12:00:00Z', now)).toBe('3 days ago');
  });
  it('builds rotation from active announcements then slides', () => {
    const snap: DisplaySnapshot = {
      version: 1,
      publishedAt: '2026-10-11T00:00:00Z',
      mosque: { id: 1, name: 'M', city: null, timezone: 'UTC' },
      days,
      jummah: [],
      announcements: [
        { id: 1, title: 'Now', body: '', startDate: '2026-10-11', endDate: '2026-10-11' },
        { id: 2, title: 'Later', body: '', startDate: '2026-10-15', endDate: '2026-10-16' },
      ],
      slides: [{ id: 9, url: '/uploads/x.png', caption: null, durationSec: 8 }],
    };
    const r = buildRotation(snap, '2026-10-11');
    expect(r.map((x) => x.kind)).toEqual(['announcement', 'slide']);
    expect(r[1].durationSec).toBe(8);
  });
});

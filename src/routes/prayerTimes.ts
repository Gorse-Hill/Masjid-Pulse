import { Router } from 'express';
import { computeAdhan } from '../shared/prayertimes.js';
import { CALC_METHOD_KEYS, minutesToTime, type CalcMethodKey } from '../shared/display.js';
import { HttpError } from '../middleware/errors.js';

const NAMES: Record<string, string> = {
  fajr: 'Fajr',
  sunrise: 'Sunrise',
  dhuhr: 'Dhuhr',
  asr: 'Asr',
  maghrib: 'Maghrib',
  isha: 'Isha',
};

function todayIn(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().slice(0, 10);
}

/** Public prayer times for the phone alert. No login. */
export function prayerTimesRouter(): Router {
  const r = Router();

  r.get('/prayer-times', (req, res) => {
    const latitude = Number(req.query.lat);
    const longitude = Number(req.query.lng);
    const timezone = String(req.query.tz || 'Africa/Mogadishu');
    const method = String(req.query.method || 'MWL') as CalcMethodKey;
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      throw new HttpError(400, 'lat is required and must be between -90 and 90');
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new HttpError(400, 'lng is required and must be between -180 and 180');
    }
    if (!(CALC_METHOD_KEYS as readonly string[]).includes(method)) {
      throw new HttpError(400, 'unknown calculation method');
    }
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
    } catch {
      throw new HttpError(400, 'unknown timezone');
    }
    const date = todayIn(timezone);
    const settings = {
      latitude,
      longitude,
      timezone,
      method,
      madhab: 'shafi' as const,
      highLatitudeRule: 'auto' as const,
    };
    const today = computeAdhan(settings, date);
    const tomorrow = computeAdhan(settings, addDay(date));
    const fajrTomorrow = tomorrow.find((p) => p.key === 'fajr');
    res.json({
      date,
      timezone,
      method,
      prayers: today.map((p) => ({
        key: p.key,
        name: NAMES[p.key] || p.key,
        time: minutesToTime(p.minutes),
        minutes: p.minutes,
      })),
      tomorrowFajr: fajrTomorrow
        ? { time: minutesToTime(fajrTomorrow.minutes), minutes: fajrTomorrow.minutes }
        : null,
    });
  });

  return r;
}

import { Router } from 'express';
import { z } from 'zod';
import { type Ctx, zDate, zPrayer, zTime } from './context.js';
import { requireMosqueRole } from '../middleware/auth.js';
import { badRequest } from '../middleware/errors.js';
import { bumpRevision, logAudit } from '../services/audit.js';
import { getMosque } from '../services/snapshot.js';
import { getEffectiveDay, getIqamahRules, saveIqamahRule, setOverride } from '../services/prayers.js';
import {
  CALC_METHOD_KEYS,
  type CalcSettings,
  HIGH_LAT_RULES,
  type IqamahRules,
  PRAYER_KEYS,
  isValidTimezone,
  localNow,
} from '../shared/display.js';
import { CALC_METHOD_LABELS, computeDay, datesAround } from '../shared/prayertimes.js';

export const zCalc = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  timezone: z.string().refine(isValidTimezone, 'Unknown timezone'),
  method: z.enum(CALC_METHOD_KEYS),
  madhab: z.enum(['shafi', 'hanafi']),
  highLatitudeRule: z.enum(HIGH_LAT_RULES),
});

export const zRule = z
  .object({
    mode: z.enum(['offset', 'fixed', 'none']),
    offsetMinutes: z.number().int().min(0).max(180).optional(),
    fixedTime: zTime.nullable().optional(),
    roundTo: z
      .number()
      .int()
      .refine((v) => [0, 5, 10, 15, 30].includes(v), 'roundTo must be 0, 5, 10, 15 or 30')
      .optional(),
    roundMode: z.enum(['nearest', 'up']).optional(),
  })
  .refine((r) => r.mode !== 'fixed' || !!r.fixedTime, { message: 'fixedTime is required for fixed mode' })
  .refine((r) => r.mode !== 'offset' || r.offsetMinutes !== undefined, {
    message: 'offsetMinutes is required for offset mode',
  });

const zRules = z.object(
  Object.fromEntries(PRAYER_KEYS.map((k) => [k, zRule])) as Record<
    (typeof PRAYER_KEYS)[number],
    typeof zRule
  >,
);

interface MosqueSettingsRow {
  prayer_source: 'manual' | 'calculated';
  latitude: number | null;
  longitude: number | null;
  timezone: string;
  calc_method: string;
  madhab: string;
  high_lat_rule: string;
}

export function prayerSettingsRouter({ db, config }: Ctx): Router {
  const r = Router({ mergeParams: true });
  const editor = requireMosqueRole(db, 'editor');
  const admin = requireMosqueRole(db, 'admin');

  const read = (mosqueId: number) => {
    const m = db
      .prepare(
        'SELECT prayer_source, latitude, longitude, timezone, calc_method, madhab, high_lat_rule FROM mosques WHERE id = ?',
      )
      .get(mosqueId) as MosqueSettingsRow;
    return {
      source: m.prayer_source,
      latitude: m.latitude,
      longitude: m.longitude,
      timezone: m.timezone,
      method: m.calc_method,
      madhab: m.madhab,
      highLatitudeRule: m.high_lat_rule,
      rules: getIqamahRules(db, mosqueId),
    };
  };

  r.get('/prayer-settings', editor, (req, res) => {
    res.json({
      ...read(req.mosqueId!),
      methods: CALC_METHOD_KEYS.map((k) => ({ key: k, label: CALC_METHOD_LABELS[k] })),
      highLatitudeRules: HIGH_LAT_RULES,
    });
  });

  // Location + calculation method. Switching to "calculated" requires a location.
  r.put('/prayer-settings', admin, (req, res) => {
    const body = z
      .object({ source: z.enum(['manual', 'calculated']) })
      .and(zCalc.partial())
      .parse(req.body);
    const cur = read(req.mosqueId!);
    const next = {
      latitude: body.latitude ?? cur.latitude,
      longitude: body.longitude ?? cur.longitude,
      timezone: body.timezone ?? cur.timezone,
      method: body.method ?? cur.method,
      madhab: body.madhab ?? cur.madhab,
      highLatitudeRule: body.highLatitudeRule ?? cur.highLatitudeRule,
    };
    if (body.source === 'calculated' && (next.latitude === null || next.longitude === null)) {
      throw badRequest('Latitude and longitude are required for automatic prayer times');
    }
    db.prepare(
      `UPDATE mosques SET prayer_source = ?, latitude = ?, longitude = ?, timezone = ?, calc_method = ?, madhab = ?,
       high_lat_rule = ? WHERE id = ?`,
    ).run(
      body.source,
      next.latitude,
      next.longitude,
      next.timezone,
      next.method,
      next.madhab,
      next.highLatitudeRule,
      req.mosqueId!,
    );
    bumpRevision(db, req.mosqueId!);
    logAudit(db, {
      mosqueId: req.mosqueId!,
      userId: req.user!.id,
      action: 'prayer_settings.update',
      entityType: 'mosque',
      entityId: req.mosqueId!,
      details: body,
    });
    res.json(read(req.mosqueId!));
  });

  r.put('/iqamah-rules', editor, (req, res) => {
    const rules = zRules.partial().parse(req.body);
    db.transaction(() => {
      for (const [k, rule] of Object.entries(rules)) {
        if (rule) saveIqamahRule(db, req.mosqueId!, k as (typeof PRAYER_KEYS)[number], rule);
      }
    })();
    bumpRevision(db, req.mosqueId!);
    logAudit(db, {
      mosqueId: req.mosqueId!,
      userId: req.user!.id,
      action: 'iqamah_rules.update',
      entityType: 'mosque',
      entityId: req.mosqueId!,
      details: rules,
    });
    res.json(getIqamahRules(db, req.mosqueId!));
  });

  /** Live preview of calculated times for unsaved settings (nothing is stored). */
  r.post('/prayer-settings/preview', editor, (req, res) => {
    const body = z
      .object({
        calc: zCalc,
        rules: zRules.partial().optional(),
        from: zDate.optional(),
        days: z.number().int().min(1).max(31).default(7),
      })
      .parse(req.body);
    const rules: IqamahRules = { ...getIqamahRules(db, req.mosqueId!), ...(body.rules ?? {}) } as IqamahRules;
    const from = body.from ?? localNow(body.calc.timezone, config.now()).date;
    try {
      res.json({
        from,
        days: datesAround(from, 0, body.days - 1).map((d) => computeDay(body.calc as CalcSettings, rules, d)),
      });
    } catch (e) {
      throw badRequest((e as Error).message);
    }
  });

  /** "Today only" adhan and/or iqamah override for one prayer on one date. */
  r.put('/prayers/:date/override', editor, (req, res) => {
    const date = zDate.parse(req.params.date);
    const b = z
      .object({ prayer: zPrayer, adhan: zTime.nullable().optional(), iqamah: zTime.nullable().optional() })
      .refine((x) => x.adhan || x.iqamah, { message: 'adhan or iqamah is required' })
      .parse(req.body);
    getMosque(db, req.mosqueId!);
    setOverride(db, req.mosqueId!, date, b.prayer, b.adhan ?? null, b.iqamah ?? null);
    bumpRevision(db, req.mosqueId!);
    logAudit(db, {
      mosqueId: req.mosqueId!,
      userId: req.user!.id,
      action: 'override.set',
      entityType: 'prayer_schedule',
      entityId: date,
      details: b,
    });
    res.json({ ok: true, effective: getEffectiveDay(db, req.mosqueId!, date) });
  });

  return r;
}

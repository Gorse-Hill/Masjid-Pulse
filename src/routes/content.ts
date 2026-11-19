import { Router } from 'express';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { type Ctx, intParam, zDate, zPrayer, zTime } from './context.js';
import { requireMosqueRole } from '../middleware/auth.js';
import { badRequest, notFound } from '../middleware/errors.js';
import { bumpRevision, logAudit } from '../services/audit.js';
import {
  getCalcSettings,
  clearOverrides,
  getBaseSchedule,
  getEffectiveDay,
  getOverrides,
  setIqamah,
  upsertSchedule,
} from '../services/prayers.js';
import { PRAYER_KEYS, addDays, isAnnouncementActive, isValidTimezone, localNow } from '../shared/display.js';
import { getMosque } from '../services/snapshot.js';
import { randomToken } from '../services/crypto.js';

const dayBody = z.object(
  Object.fromEntries(
    PRAYER_KEYS.map((k) => [k, z.object({ adhan: zTime, iqamah: zTime.nullable().optional() })]),
  ) as Record<
    (typeof PRAYER_KEYS)[number],
    z.ZodObject<{ adhan: typeof zTime; iqamah: z.ZodOptional<z.ZodNullable<typeof zTime>> }>
  >,
);

const jummahBody = z.object({
  label: z.string().trim().min(1).max(60),
  khutbah: zTime,
  iqamah: zTime,
  language: z.string().trim().max(40).nullable().optional(),
  sortOrder: z.number().int().optional(),
});

const announcementBody = z
  .object({
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().max(1000).default(''),
    startDate: zDate,
    endDate: zDate,
  })
  .refine((a) => a.startDate <= a.endDate, {
    message: 'endDate must be on or after startDate',
    path: ['endDate'],
  });

const ALLOWED_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

export function announcementStatus(a: { startDate: string; endDate: string }, today: string) {
  if (isAnnouncementActive(a, today)) return 'active';
  return a.endDate < today ? 'expired' : 'scheduled';
}

export function contentRouter({ db, config }: Ctx): Router {
  const r = Router({ mergeParams: true });
  const editor = requireMosqueRole(db, 'editor');
  const admin = requireMosqueRole(db, 'admin');
  const today = (mosqueId: number) => localNow(getMosque(db, mosqueId).timezone, config.now()).date;

  // ---- Mosque settings ----
  r.get('/', editor, (req, res) => {
    const m = getMosque(db, req.mosqueId!);
    res.json({
      id: m.id,
      name: m.name,
      city: m.city,
      timezone: m.timezone,
      paused: !!m.paused,
      prayerSource: (m as unknown as { prayer_source: string }).prayer_source,
      role: req.role,
    });
  });

  r.patch('/', admin, (req, res) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(150).optional(),
        city: z.string().trim().max(100).nullable().optional(),
        timezone: z.string().refine(isValidTimezone, 'Unknown timezone').optional(),
      })
      .parse(req.body);
    const m = getMosque(db, req.mosqueId!);
    db.prepare('UPDATE mosques SET name = ?, city = ?, timezone = ? WHERE id = ?').run(
      body.name ?? m.name,
      body.city === undefined ? m.city : body.city,
      body.timezone ?? m.timezone,
      m.id,
    );
    bumpRevision(db, m.id);
    logAudit(db, {
      mosqueId: m.id,
      userId: req.user!.id,
      action: 'mosque.update',
      entityType: 'mosque',
      entityId: m.id,
      details: body,
    });
    res.json({ ok: true });
  });

  // ---- Prayer schedule ----
  r.get('/prayers', editor, (req, res) => {
    const from = req.query.from ? zDate.parse(req.query.from) : today(req.mosqueId!);
    const days = Math.min(Math.max(Number(req.query.days ?? 7) || 7, 1), 62);
    const out = [];
    for (let i = 0; i < days; i++) {
      const date = addDays(from, i);
      const base = getBaseSchedule(db, req.mosqueId!, date);
      out.push({
        date,
        sourceDate: base?.sourceDate ?? null,
        explicit: base?.sourceDate === date,
        effective: getEffectiveDay(db, req.mosqueId!, date),
        overrides: getOverrides(db, req.mosqueId!, date),
      });
    }
    res.json({
      today: today(req.mosqueId!),
      mode: getCalcSettings(db, req.mosqueId!) ? 'calculated' : 'manual',
      days: out,
    });
  });

  r.put('/prayers/:date', editor, (req, res) => {
    const date = zDate.parse(req.params.date);
    const body = dayBody.parse(req.body);
    upsertSchedule(
      db,
      req.mosqueId!,
      date,
      PRAYER_KEYS.map((k) => ({ key: k, adhan: body[k].adhan, iqamah: body[k].iqamah ?? null })),
    );
    bumpRevision(db, req.mosqueId!);
    logAudit(db, {
      mosqueId: req.mosqueId!,
      userId: req.user!.id,
      action: 'prayers.update',
      entityType: 'prayer_schedule',
      entityId: date,
      details: body,
    });
    res.json({ ok: true, effective: getEffectiveDay(db, req.mosqueId!, date) });
  });

  // Quick iqamah update path (mobile "Today" screen).
  r.patch('/prayers/:date/iqamah', editor, (req, res) => {
    const date = zDate.parse(req.params.date);
    const body = z
      .object({ prayer: zPrayer, iqamah: zTime, todayOnly: z.boolean().default(false) })
      .parse(req.body);
    setIqamah(db, req.mosqueId!, date, body.prayer, body.iqamah, body.todayOnly);
    bumpRevision(db, req.mosqueId!);
    logAudit(db, {
      mosqueId: req.mosqueId!,
      userId: req.user!.id,
      action: 'iqamah.update',
      entityType: 'prayer_schedule',
      entityId: date,
      details: body,
    });
    res.json({ ok: true, effective: getEffectiveDay(db, req.mosqueId!, date) });
  });

  r.delete('/prayers/:date/overrides', editor, (req, res) => {
    const date = zDate.parse(req.params.date);
    const removed = clearOverrides(db, req.mosqueId!, date);
    bumpRevision(db, req.mosqueId!);
    logAudit(db, {
      mosqueId: req.mosqueId!,
      userId: req.user!.id,
      action: 'overrides.clear',
      entityType: 'prayer_schedule',
      entityId: date,
    });
    res.json({ ok: true, removed });
  });

  // ---- Jummah ----
  const jummahSelect =
    'SELECT id, label, khutbah_time AS khutbah, iqamah_time AS iqamah, language, sort_order AS sortOrder FROM jummah_schedules';
  r.get('/jummah', editor, (req, res) => {
    res.json(
      db.prepare(`${jummahSelect} WHERE mosque_id = ? ORDER BY sort_order, iqamah_time`).all(req.mosqueId!),
    );
  });
  r.post('/jummah', editor, (req, res) => {
    const b = jummahBody.parse(req.body);
    if (b.iqamah < b.khutbah) throw badRequest('Iqamah must be after khutbah');
    const info = db
      .prepare(
        'INSERT INTO jummah_schedules (mosque_id, label, khutbah_time, iqamah_time, language, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(req.mosqueId!, b.label, b.khutbah, b.iqamah, b.language ?? null, b.sortOrder ?? 0);
    bumpRevision(db, req.mosqueId!);
    logAudit(db, {
      mosqueId: req.mosqueId!,
      userId: req.user!.id,
      action: 'jummah.create',
      entityType: 'jummah',
      entityId: Number(info.lastInsertRowid),
      details: b,
    });
    res.status(201).json(db.prepare(`${jummahSelect} WHERE id = ?`).get(info.lastInsertRowid));
  });
  r.put('/jummah/:id', editor, (req, res) => {
    const b = jummahBody.parse(req.body);
    if (b.iqamah < b.khutbah) throw badRequest('Iqamah must be after khutbah');
    const info = db
      .prepare(
        'UPDATE jummah_schedules SET label = ?, khutbah_time = ?, iqamah_time = ?, language = ?, sort_order = ? WHERE id = ? AND mosque_id = ?',
      )
      .run(
        b.label,
        b.khutbah,
        b.iqamah,
        b.language ?? null,
        b.sortOrder ?? 0,
        intParam(req.params.id),
        req.mosqueId!,
      );
    if (!info.changes) throw notFound('Jummah entry not found');
    bumpRevision(db, req.mosqueId!);
    logAudit(db, {
      mosqueId: req.mosqueId!,
      userId: req.user!.id,
      action: 'jummah.update',
      entityType: 'jummah',
      entityId: String(req.params.id),
      details: b,
    });
    res.json(db.prepare(`${jummahSelect} WHERE id = ?`).get(intParam(req.params.id)));
  });
  r.delete('/jummah/:id', editor, (req, res) => {
    const info = db
      .prepare('DELETE FROM jummah_schedules WHERE id = ? AND mosque_id = ?')
      .run(intParam(req.params.id), req.mosqueId!);
    if (!info.changes) throw notFound('Jummah entry not found');
    bumpRevision(db, req.mosqueId!);
    logAudit(db, {
      mosqueId: req.mosqueId!,
      userId: req.user!.id,
      action: 'jummah.delete',
      entityType: 'jummah',
      entityId: String(req.params.id),
    });
    res.json({ ok: true });
  });

  // ---- Announcements ----
  const annSelect =
    'SELECT id, title, body, start_date AS startDate, end_date AS endDate, created_at AS createdAt FROM announcements';
  r.get('/announcements', editor, (req, res) => {
    const t = today(req.mosqueId!);
    const rows = db
      .prepare(`${annSelect} WHERE mosque_id = ? AND deleted_at IS NULL ORDER BY end_date DESC, id DESC`)
      .all(req.mosqueId!) as { startDate: string; endDate: string }[];
    const withStatus = rows.map((a) => ({ ...a, status: announcementStatus(a, t) }));
    const filter = req.query.status;
    res.json(filter ? withStatus.filter((a) => a.status === filter) : withStatus);
  });
  r.post('/announcements', editor, (req, res) => {
    const b = announcementBody.parse(req.body);
    const info = db
      .prepare(
        'INSERT INTO announcements (mosque_id, title, body, start_date, end_date, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(req.mosqueId!, b.title, b.body, b.startDate, b.endDate, req.user!.id);
    bumpRevision(db, req.mosqueId!);
    logAudit(db, {
      mosqueId: req.mosqueId!,
      userId: req.user!.id,
      action: 'announcement.create',
      entityType: 'announcement',
      entityId: Number(info.lastInsertRowid),
      details: { title: b.title },
    });
    const row = db.prepare(`${annSelect} WHERE id = ?`).get(info.lastInsertRowid) as {
      startDate: string;
      endDate: string;
    };
    res.status(201).json({ ...row, status: announcementStatus(row, today(req.mosqueId!)) });
  });
  r.put('/announcements/:id', editor, (req, res) => {
    const b = announcementBody.parse(req.body);
    const info = db
      .prepare(
        'UPDATE announcements SET title = ?, body = ?, start_date = ?, end_date = ? WHERE id = ? AND mosque_id = ? AND deleted_at IS NULL',
      )
      .run(b.title, b.body, b.startDate, b.endDate, intParam(req.params.id), req.mosqueId!);
    if (!info.changes) throw notFound('Announcement not found');
    bumpRevision(db, req.mosqueId!);
    logAudit(db, {
      mosqueId: req.mosqueId!,
      userId: req.user!.id,
      action: 'announcement.update',
      entityType: 'announcement',
      entityId: String(req.params.id),
      details: { title: b.title },
    });
    res.json({ ok: true });
  });
  r.delete('/announcements/:id', editor, (req, res) => {
    const info = db
      .prepare(
        'UPDATE announcements SET deleted_at = ? WHERE id = ? AND mosque_id = ? AND deleted_at IS NULL',
      )
      .run(config.now().toISOString(), intParam(req.params.id), req.mosqueId!);
    if (!info.changes) throw notFound('Announcement not found');
    bumpRevision(db, req.mosqueId!);
    logAudit(db, {
      mosqueId: req.mosqueId!,
      userId: req.user!.id,
      action: 'announcement.delete',
      entityType: 'announcement',
      entityId: String(req.params.id),
    });
    res.json({ ok: true });
  });

  // ---- Slides ----
  fs.mkdirSync(config.uploadDir, { recursive: true });
  const upload = multer({
    storage: multer.diskStorage({
      destination: config.uploadDir,
      filename: (_req, file, cb) =>
        cb(null, `${Date.now()}-${randomToken(8)}${ALLOWED_MIME[file.mimetype] ?? ''}`),
    }),
    limits: { fileSize: config.maxSlideBytes, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (ALLOWED_MIME[file.mimetype]) cb(null, true);
      else cb(badRequest('Only PNG, JPEG or WebP images are allowed'));
    },
  });
  const slideSelect =
    'SELECT id, filename, mime, size_bytes AS sizeBytes, caption, duration_sec AS durationSec, sort_order AS sortOrder, active FROM slides';
  const slideOut = (s: { filename: string; active: number }) => ({
    ...s,
    active: !!s.active,
    url: `/uploads/${s.filename}`,
  });

  r.get('/slides', editor, (req, res) => {
    const rows = db
      .prepare(`${slideSelect} WHERE mosque_id = ? AND deleted_at IS NULL ORDER BY sort_order, id`)
      .all(req.mosqueId!) as { filename: string; active: number }[];
    res.json(rows.map(slideOut));
  });
  r.post('/slides', editor, upload.single('image'), (req, res) => {
    if (!req.file) throw badRequest('Image file is required (field "image")');
    const meta = z
      .object({
        caption: z.string().trim().max(200).optional(),
        durationSec: z.coerce.number().int().min(3).max(120).default(10),
      })
      .safeParse(req.body ?? {});
    if (!meta.success) {
      fs.rmSync(req.file.path, { force: true });
      throw badRequest('Invalid slide details', meta.error.issues);
    }
    const info = db
      .prepare(
        'INSERT INTO slides (mosque_id, filename, mime, size_bytes, caption, duration_sec) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        req.mosqueId!,
        path.basename(req.file.path),
        req.file.mimetype,
        req.file.size,
        meta.data.caption ?? null,
        meta.data.durationSec,
      );
    bumpRevision(db, req.mosqueId!);
    logAudit(db, {
      mosqueId: req.mosqueId!,
      userId: req.user!.id,
      action: 'slide.create',
      entityType: 'slide',
      entityId: Number(info.lastInsertRowid),
      details: { sizeBytes: req.file.size },
    });
    res.status(201).json(
      slideOut(
        db.prepare(`${slideSelect} WHERE id = ?`).get(info.lastInsertRowid) as {
          filename: string;
          active: number;
        },
      ),
    );
  });
  r.patch('/slides/:id', editor, (req, res) => {
    const b = z
      .object({
        caption: z.string().trim().max(200).nullable().optional(),
        durationSec: z.number().int().min(3).max(120).optional(),
        active: z.boolean().optional(),
        sortOrder: z.number().int().optional(),
      })
      .parse(req.body);
    const cur = db
      .prepare(`${slideSelect} WHERE id = ? AND mosque_id = ? AND deleted_at IS NULL`)
      .get(intParam(req.params.id), req.mosqueId!) as
      | { id: number; caption: string | null; durationSec: number; active: number; sortOrder: number }
      | undefined;
    if (!cur) throw notFound('Slide not found');
    db.prepare(
      'UPDATE slides SET caption = ?, duration_sec = ?, active = ?, sort_order = ? WHERE id = ?',
    ).run(
      b.caption === undefined ? cur.caption : b.caption,
      b.durationSec ?? cur.durationSec,
      b.active === undefined ? cur.active : b.active ? 1 : 0,
      b.sortOrder ?? cur.sortOrder,
      cur.id,
    );
    bumpRevision(db, req.mosqueId!);
    logAudit(db, {
      mosqueId: req.mosqueId!,
      userId: req.user!.id,
      action: 'slide.update',
      entityType: 'slide',
      entityId: cur.id,
      details: b,
    });
    res.json({ ok: true });
  });
  r.delete('/slides/:id', editor, (req, res) => {
    // Soft delete: the file is kept so TVs still showing an older snapshot don't break.
    const info = db
      .prepare('UPDATE slides SET deleted_at = ? WHERE id = ? AND mosque_id = ? AND deleted_at IS NULL')
      .run(config.now().toISOString(), intParam(req.params.id), req.mosqueId!);
    if (!info.changes) throw notFound('Slide not found');
    bumpRevision(db, req.mosqueId!);
    logAudit(db, {
      mosqueId: req.mosqueId!,
      userId: req.user!.id,
      action: 'slide.delete',
      entityType: 'slide',
      entityId: String(req.params.id),
    });
    res.json({ ok: true });
  });

  return r;
}

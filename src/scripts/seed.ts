/**
 * Seed a demo mosque. Idempotent: does nothing if the demo user already exists.
 * Usage: npm run seed   (DATABASE_FILE and SEED_TIMEZONE env vars are optional)
 */
import bcrypt from 'bcryptjs';
import { openDatabase, type DB } from '../db/db.js';
import { upsertSchedule } from '../services/prayers.js';
import { publishSnapshot } from '../services/snapshot.js';
import { logAudit } from '../services/audit.js';
import { addDays, localNow } from '../shared/display.js';

export const DEMO_EMAIL = 'demo@masjidpulse.local';
export const DEMO_PASSWORD = 'demo-password-123';

export function seed(
  db: DB,
  timezone = 'Europe/London',
  now = new Date(),
): { mosqueId: number; created: boolean } {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(DEMO_EMAIL) as
    { id: number } | undefined;
  if (existing) {
    const m = db.prepare('SELECT mosque_id FROM mosque_users WHERE user_id = ?').get(existing.id) as {
      mosque_id: number;
    };
    return { mosqueId: m.mosque_id, created: false };
  }
  const userId = Number(
    db
      .prepare(
        "INSERT INTO users (email, password_hash, name, email_verified_at) VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
      )
      .run(DEMO_EMAIL, bcrypt.hashSync(DEMO_PASSWORD, 10), 'Demo Volunteer').lastInsertRowid,
  );
  const mosqueId = Number(
    db
      .prepare('INSERT INTO mosques (name, city, timezone) VALUES (?, ?, ?)')
      .run('Masjid An-Noor (Demo)', 'Demo City', timezone).lastInsertRowid,
  );
  db.prepare("INSERT INTO mosque_users (mosque_id, user_id, role) VALUES (?, ?, 'owner')").run(
    mosqueId,
    userId,
  );
  logAudit(db, {
    mosqueId,
    userId,
    action: 'mosque.register',
    entityType: 'mosque',
    entityId: mosqueId,
    details: { seed: true },
  });

  const today = localNow(timezone, now).date;
  upsertSchedule(db, mosqueId, today, [
    { key: 'fajr', adhan: '05:15', iqamah: '05:45' },
    { key: 'dhuhr', adhan: '12:30', iqamah: '13:00' },
    { key: 'asr', adhan: '15:45', iqamah: '16:00' },
    { key: 'maghrib', adhan: '18:05', iqamah: '18:10' },
    { key: 'isha', adhan: '19:30', iqamah: '19:45' },
  ]);
  const jummah = db.prepare(
    'INSERT INTO jummah_schedules (mosque_id, label, khutbah_time, iqamah_time, language, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
  );
  jummah.run(mosqueId, "1st Jumu'ah", '12:45', '13:15', 'English', 0);
  jummah.run(mosqueId, "2nd Jumu'ah", '13:45', '14:15', 'Arabic', 1);
  const ann = db.prepare(
    'INSERT INTO announcements (mosque_id, title, body, start_date, end_date, created_by) VALUES (?, ?, ?, ?, ?, ?)',
  );
  ann.run(
    mosqueId,
    'Welcome to Masjid An-Noor',
    'Please switch your phones to silent before entering the prayer hall.',
    today,
    addDays(today, 30),
    userId,
  );
  ann.run(
    mosqueId,
    'Weekend Quran Circle',
    'Saturday after Fajr in the main hall. All welcome.',
    today,
    addDays(today, 7),
    userId,
  );
  publishSnapshot(db, mosqueId, userId, now);
  return { mosqueId, created: true };
}

const isMain =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop()!);
if (isMain) {
  const db = openDatabase(process.env.DATABASE_FILE ?? 'data/masjid-pulse.db');
  const out = seed(db, process.env.SEED_TIMEZONE ?? 'Europe/London');
  console.log(
    out.created
      ? `Seeded demo mosque #${out.mosqueId}. Login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`
      : `Demo data already present (mosque #${out.mosqueId}). Login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`,
  );
  db.close();
}

/**
 * SQL schema. Written in portable SQL (plus SQLite triggers) so it can be ported to Postgres.
 * Every tenant-owned table carries mosque_id; all queries filter by it.
 */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE mosques (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    city TEXT,
    timezone TEXT NOT NULL,
    paused INTEGER NOT NULL DEFAULT 0,
    paused_snapshot_id INTEGER,
    draft_revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE mosque_users (
    mosque_id INTEGER NOT NULL REFERENCES mosques(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner','admin','editor')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (mosque_id, user_id)
  );

  CREATE TABLE prayer_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mosque_id INTEGER NOT NULL REFERENCES mosques(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    fajr_adhan TEXT NOT NULL, fajr_iqamah TEXT,
    dhuhr_adhan TEXT NOT NULL, dhuhr_iqamah TEXT,
    asr_adhan TEXT NOT NULL, asr_iqamah TEXT,
    maghrib_adhan TEXT NOT NULL, maghrib_iqamah TEXT,
    isha_adhan TEXT NOT NULL, isha_iqamah TEXT,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (mosque_id, date)
  );

  -- "Today only" overrides: apply to exactly one date and never carry forward.
  CREATE TABLE prayer_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mosque_id INTEGER NOT NULL REFERENCES mosques(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    prayer TEXT NOT NULL CHECK (prayer IN ('fajr','dhuhr','asr','maghrib','isha')),
    adhan TEXT,
    iqamah TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (mosque_id, date, prayer)
  );

  CREATE TABLE jummah_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mosque_id INTEGER NOT NULL REFERENCES mosques(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    khutbah_time TEXT NOT NULL,
    iqamah_time TEXT NOT NULL,
    language TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mosque_id INTEGER NOT NULL REFERENCES mosques(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    deleted_at TEXT
  );

  CREATE TABLE slides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mosque_id INTEGER NOT NULL REFERENCES mosques(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    mime TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    caption TEXT,
    duration_sec INTEGER NOT NULL DEFAULT 10,
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    deleted_at TEXT
  );

  CREATE TABLE devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mosque_id INTEGER NOT NULL REFERENCES mosques(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_seen_at TEXT,
    last_snapshot_version INTEGER,
    revoked_at TEXT
  );

  CREATE TABLE pairing_codes (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    secret_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    claimed_at TEXT,
    mosque_id INTEGER REFERENCES mosques(id) ON DELETE CASCADE,
    device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
    pending_token TEXT,
    delivered_at TEXT
  );
  CREATE INDEX idx_pairing_code ON pairing_codes(code);

  CREATE TABLE display_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mosque_id INTEGER NOT NULL REFERENCES mosques(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    payload TEXT NOT NULL,
    source_revision INTEGER NOT NULL,
    published_by INTEGER REFERENCES users(id),
    published_at TEXT NOT NULL,
    UNIQUE (mosque_id, version)
  );

  CREATE TABLE audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mosque_id INTEGER NOT NULL REFERENCES mosques(id),
    user_id INTEGER REFERENCES users(id),
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_audit_mosque ON audit_logs(mosque_id, id);

  -- Audit log is append-only.
  CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs
  BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
  CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs
  BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;
  `,
  `
  ALTER TABLE mosques ADD COLUMN prayer_source TEXT NOT NULL DEFAULT 'manual'
    CHECK (prayer_source IN ('manual','calculated'));
  ALTER TABLE mosques ADD COLUMN latitude REAL;
  ALTER TABLE mosques ADD COLUMN longitude REAL;
  ALTER TABLE mosques ADD COLUMN calc_method TEXT NOT NULL DEFAULT 'MWL';
  ALTER TABLE mosques ADD COLUMN madhab TEXT NOT NULL DEFAULT 'shafi' CHECK (madhab IN ('shafi','hanafi'));
  ALTER TABLE mosques ADD COLUMN high_lat_rule TEXT NOT NULL DEFAULT 'auto';

  CREATE TABLE iqamah_rules (
    mosque_id INTEGER NOT NULL REFERENCES mosques(id) ON DELETE CASCADE,
    prayer TEXT NOT NULL CHECK (prayer IN ('fajr','dhuhr','asr','maghrib','isha')),
    mode TEXT NOT NULL CHECK (mode IN ('offset','fixed','none')),
    offset_minutes INTEGER,
    fixed_time TEXT,
    round_to INTEGER NOT NULL DEFAULT 0,
    round_mode TEXT NOT NULL DEFAULT 'nearest' CHECK (round_mode IN ('nearest','up')),
    PRIMARY KEY (mosque_id, prayer)
  );
  `,
  `
  ALTER TABLE users ADD COLUMN email_verified_at TEXT;
  ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;
  -- Accounts created before email verification existed are treated as verified.
  UPDATE users SET email_verified_at = created_at;

  -- Signed, expiring, single-use email tokens (verification, password reset, invitations).
  CREATE TABLE email_tokens (
    id TEXT PRIMARY KEY,
    purpose TEXT NOT NULL CHECK (purpose IN ('verify','reset','invite')),
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    mosque_id INTEGER REFERENCES mosques(id) ON DELETE CASCADE,
    role TEXT CHECK (role IN ('owner','admin','editor')),
    name TEXT,
    invited_by INTEGER REFERENCES users(id),
    token_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_email_tokens_user ON email_tokens(user_id, purpose);
  CREATE INDEX idx_email_tokens_mosque ON email_tokens(mosque_id, purpose);
  `,
  `
  -- Standing TV notices: donation collections, fundraising, and mosque payment numbers.
  CREATE TABLE donations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mosque_id INTEGER NOT NULL REFERENCES mosques(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('donation','fundraising','payment')),
    method TEXT,
    account TEXT,
    note TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    deleted_at TEXT
  );
  CREATE INDEX idx_donations_mosque ON donations(mosque_id, id);
  `,
];

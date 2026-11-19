import type { DB } from '../db/db.js';

export interface AuditEntry {
  mosqueId: number;
  userId: number | null;
  action: string;
  entityType?: string;
  entityId?: string | number | null;
  details?: unknown;
}

/** Append-only audit log write. (UPDATE/DELETE are blocked by DB triggers.) */
export function logAudit(db: DB, e: AuditEntry): void {
  db.prepare(
    'INSERT INTO audit_logs (mosque_id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    e.mosqueId,
    e.userId,
    e.action,
    e.entityType ?? null,
    e.entityId === undefined || e.entityId === null ? null : String(e.entityId),
    e.details === undefined ? null : JSON.stringify(e.details),
  );
}

/** Marks the mosque's draft content as changed (used for "unpublished changes" status). */
export function bumpRevision(db: DB, mosqueId: number): void {
  db.prepare('UPDATE mosques SET draft_revision = draft_revision + 1 WHERE id = ?').run(mosqueId);
}

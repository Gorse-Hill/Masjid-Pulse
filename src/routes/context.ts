import type { DB } from '../db/db.js';
import type { AppConfig } from '../config.js';
import { z } from 'zod';
import { isValidDate, isValidTime, PRAYER_KEYS } from '../shared/display.js';

export interface Ctx {
  db: DB;
  config: AppConfig;
}

export const zTime = z.string().refine(isValidTime, 'Must be HH:MM (24h)');
export const zDate = z.string().refine(isValidDate, 'Must be YYYY-MM-DD');
export const zPrayer = z.enum(PRAYER_KEYS);

export function intParam(value: unknown): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : -1;
}

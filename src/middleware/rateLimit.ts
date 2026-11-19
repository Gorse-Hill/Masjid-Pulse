import rateLimit from 'express-rate-limit';
import type { RateLimit } from '../config.js';

/** Per-IP limiter with a JSON error body consistent with the rest of the API. */
export function limiter(name: string, l: RateLimit) {
  return rateLimit({
    windowMs: l.windowMs,
    limit: l.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    identifier: name,
    handler: (_req, res) => {
      res.status(429).json({ error: 'Too many requests, please wait a few minutes and try again' });
    },
  });
}

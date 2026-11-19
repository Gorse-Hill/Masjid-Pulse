import { Router } from 'express';
import type { Ctx } from './context.js';
import { requireDevice } from '../middleware/auth.js';
import { createPairingCode, getPairingStatus } from '../services/pairing.js';
import { displaySnapshotFor, refreshSnapshotIfStale } from '../services/snapshot.js';
import { HttpError } from '../middleware/errors.js';
import { limiter } from '../middleware/rateLimit.js';

/** Endpoints used by the TV display app. */
export function tvRouter({ db, config }: Ctx): Router {
  const r = Router();

  r.post('/pairing', limiter('pairing-create', config.rateLimits.pairingCreate), (_req, res) => {
    res.status(201).json(createPairingCode(db, config.now(), config.pairingTtlMs));
  });

  r.get('/pairing/:pairingId', limiter('pairing-poll', config.rateLimits.pairingPoll), (req, res) => {
    const secret = req.header('x-pairing-secret');
    if (!secret) throw new HttpError(401, 'Pairing secret required');
    res.json(getPairingStatus(db, String(req.params.pairingId), secret, config.now()));
  });

  /**
   * Latest published snapshot for this device's mosque. Pass ?version=N (the cached version) to
   * get {unchanged:true} instead of the full payload when nothing changed.
   */
  r.get('/snapshot', requireDevice(db, config), (req, res) => {
    const device = req.device!;
    // On-demand rolling refresh when the published window is running low.
    refreshSnapshotIfStale(db, device.mosqueId, config.now());
    const result = displaySnapshotFor(db, device.mosqueId);
    res.setHeader('Cache-Control', 'no-store');
    if (!result) {
      res.json({ snapshot: null, paused: false, device: { id: device.id, name: device.name } });
      return;
    }
    db.prepare('UPDATE devices SET last_snapshot_version = ? WHERE id = ?').run(
      result.snapshot.version,
      device.id,
    );
    const known = Number(req.query.version);
    if (Number.isInteger(known) && known === result.snapshot.version) {
      res.json({ unchanged: true, version: known, paused: result.paused });
      return;
    }
    res.json({
      snapshot: result.snapshot,
      paused: result.paused,
      device: { id: device.id, name: device.name },
    });
  });

  return r;
}

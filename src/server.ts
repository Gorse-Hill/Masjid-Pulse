import { createApp } from './app.js';
import { openDatabase } from './db/db.js';
import { refreshAllSnapshots } from './services/snapshot.js';

const port = Number(process.env.PORT ?? 3000);
const db = openDatabase(process.env.DATABASE_FILE ?? 'data/masjid-pulse.db');
const app = createApp(db);
const server = app.listen(port, () => {
  console.log(`Masjid Pulse listening on http://localhost:${port}  (admin: /admin, TV: /tv)`);
});

// Hourly job: roll every mosque's published snapshot forward when its 14-day window runs low.
const refreshTimer = setInterval(
  () => {
    try {
      const n = refreshAllSnapshots(db, new Date());
      if (n) console.log(`Auto-refreshed ${n} snapshot(s)`);
    } catch (e) {
      console.error('Snapshot refresh failed', e);
    }
  },
  60 * 60 * 1000,
);
refreshTimer.unref();

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

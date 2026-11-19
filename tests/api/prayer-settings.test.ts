import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { type TestEnv, auth, makeEnv, pairTv, registerMosque } from '../helpers.js';
import { refreshAllSnapshots, refreshSnapshotIfStale } from '../../src/services/snapshot.js';

let env: TestEnv;
beforeEach(() => {
  env = makeEnv('2026-10-11T05:00:00.000Z');
});

const LONDON = {
  source: 'calculated',
  latitude: 51.5074,
  longitude: -0.1278,
  timezone: 'Europe/London',
  method: 'MWL',
  madhab: 'shafi',
  highLatitudeRule: 'twilightangle',
};

async function calculatedMosque() {
  const o = await registerMosque(env, { timezone: 'Europe/London' });
  const m = `/api/mosques/${o.mosqueId}`;
  await request(env.app).put(`${m}/prayer-settings`).set(auth(o.token)).send(LONDON).expect(200);
  return { ...o, m };
}

describe('prayer settings API', () => {
  it('lists methods and defaults; requires a location for calculated mode', async () => {
    const o = await registerMosque(env);
    const m = `/api/mosques/${o.mosqueId}`;
    const s = await request(env.app).get(`${m}/prayer-settings`).set(auth(o.token)).expect(200);
    expect(s.body).toMatchObject({
      source: 'manual',
      method: 'MWL',
      madhab: 'shafi',
      highLatitudeRule: 'auto',
    });
    expect(s.body.methods).toHaveLength(13);
    expect(s.body.rules.maghrib).toMatchObject({ mode: 'offset', offsetMinutes: 7 });
    await request(env.app)
      .put(`${m}/prayer-settings`)
      .set(auth(o.token))
      .send({ source: 'calculated' })
      .expect(400);
    await request(env.app)
      .put(`${m}/prayer-settings`)
      .set(auth(o.token))
      .send({ ...LONDON, latitude: 123 })
      .expect(400);
    await request(env.app)
      .put(`${m}/prayer-settings`)
      .set(auth(o.token))
      .send({ ...LONDON, method: 'Nope' })
      .expect(400);
  });

  it('register with a location starts in calculated mode', async () => {
    const res = await request(env.app)
      .post('/api/auth/register')
      .send({
        name: 'A',
        email: 'loc@example.com',
        password: 'password123',
        mosqueName: 'Loc',
        timezone: 'Asia/Riyadh',
        latitude: 21.4225,
        longitude: 39.8262,
        method: 'UmmAlQura',
      })
      .expect(201);
    const today = await request(env.app)
      .get(`/api/mosques/${res.body.mosque.id}/today`)
      .set(auth(res.body.token))
      .expect(200);
    expect(today.body.today.prayers[0]).toMatchObject({ key: 'fajr', adhan: '04:59', iqamah: '05:20' });
  });

  it('computes 14 days automatically when publishing, using iqamah rules', async () => {
    const o = await calculatedMosque();
    await request(env.app)
      .put(`${o.m}/iqamah-rules`)
      .set(auth(o.token))
      .send({
        dhuhr: { mode: 'fixed', fixedTime: '13:30' },
        maghrib: { mode: 'offset', offsetMinutes: 5, roundTo: 0 },
      })
      .expect(200);
    const pub = await request(env.app).post(`${o.m}/publish`).set(auth(o.token)).expect(201);
    const days = pub.body.snapshot.days;
    expect(days).toHaveLength(14);
    expect(days[0].date).toBe('2026-10-11');
    expect(days[0].prayers[1]).toMatchObject({ adhan: '12:48', iqamah: '13:30' });
    expect(days[0].prayers[3]).toMatchObject({ adhan: '18:16', iqamah: '18:21' });
    expect(pub.body.snapshot.source).toMatchObject({ mode: 'calculated', calc: { method: 'MWL' } });
    // Last day in the 14-day window (BST still in effect)
    const oct24 = days.find((d: { date: string }) => d.date === '2026-10-24');
    expect(oct24.prayers[1].adhan).toBe('12:46');
  });

  it('validates iqamah rules', async () => {
    const o = await calculatedMosque();
    await request(env.app)
      .put(`${o.m}/iqamah-rules`)
      .set(auth(o.token))
      .send({ fajr: { mode: 'fixed' } })
      .expect(400);
    await request(env.app)
      .put(`${o.m}/iqamah-rules`)
      .set(auth(o.token))
      .send({ fajr: { mode: 'offset' } })
      .expect(400);
    await request(env.app)
      .put(`${o.m}/iqamah-rules`)
      .set(auth(o.token))
      .send({ fajr: { mode: 'offset', offsetMinutes: 10, roundTo: 7 } })
      .expect(400);
  });

  it('preview computes times for unsaved settings without storing them', async () => {
    const o = await registerMosque(env);
    const m = `/api/mosques/${o.mosqueId}`;
    const p = await request(env.app)
      .post(`${m}/prayer-settings/preview`)
      .set(auth(o.token))
      .send({ calc: { ...LONDON, source: undefined }, days: 3, from: '2026-10-11' })
      .expect(200);
    expect(p.body.days).toHaveLength(3);
    expect(p.body.days[0]).toMatchObject({ date: '2026-10-11', sunrise: '07:18' });
    const s = await request(env.app).get(`${m}/prayer-settings`).set(auth(o.token)).expect(200);
    expect(s.body.source).toBe('manual');
  });

  it('today-only override and quick iqamah work in calculated mode', async () => {
    const o = await calculatedMosque();
    await request(env.app)
      .put(`${o.m}/prayers/2026-10-11/override`)
      .set(auth(o.token))
      .send({ prayer: 'asr', adhan: '15:50' })
      .expect(200);
    await request(env.app)
      .put(`${o.m}/prayers/2026-10-11/override`)
      .set(auth(o.token))
      .send({ prayer: 'asr' })
      .expect(400);
    await request(env.app)
      .put(`${o.m}/prayers/2026-10-11/override`)
      .set(auth(o.token))
      .send({ prayer: 'asr', iqamah: '15:00' })
      .expect(400);
    await request(env.app)
      .patch(`${o.m}/prayers/2026-10-11/iqamah`)
      .set(auth(o.token))
      .send({ prayer: 'isha', iqamah: '20:30', todayOnly: true })
      .expect(200);
    // Permanent iqamah change in calculated mode becomes a fixed-time rule
    await request(env.app)
      .patch(`${o.m}/prayers/2026-10-11/iqamah`)
      .set(auth(o.token))
      .send({ prayer: 'fajr', iqamah: '06:00', todayOnly: false })
      .expect(200);
    await request(env.app)
      .patch(`${o.m}/prayers/2026-10-11/iqamah`)
      .set(auth(o.token))
      .send({ prayer: 'fajr', iqamah: '03:00', todayOnly: false })
      .expect(400);
    const list = await request(env.app).get(`${o.m}/prayers?days=2`).set(auth(o.token)).expect(200);
    expect(list.body.mode).toBe('calculated');
    const d0 = list.body.days[0].effective.prayers;
    expect(d0[2]).toMatchObject({ adhan: '15:50', iqamah: '16:05', overridden: true });
    expect(d0[4]).toMatchObject({ iqamah: '20:30', overridden: true });
    expect(list.body.days[1].effective.prayers[0].iqamah).toBe('06:00');
    expect(list.body.days[1].effective.prayers[2].overridden).toBeUndefined();
  });
});

describe('daily snapshot refresh', () => {
  it('rolls the window forward from published data only (not drafts) when it runs low', async () => {
    const o = await calculatedMosque();
    await request(env.app)
      .post(`${o.m}/announcements`)
      .set(auth(o.token))
      .send({ title: 'Short', startDate: '2026-10-11', endDate: '2026-10-12' });
    await request(env.app).post(`${o.m}/publish`).set(auth(o.token)).expect(201);
    // Unpublished draft change: must NOT leak into the refreshed snapshot
    await request(env.app)
      .put(`${o.m}/iqamah-rules`)
      .set(auth(o.token))
      .send({ isha: { mode: 'fixed', fixedTime: '21:45' } })
      .expect(200);
    expect(refreshSnapshotIfStale(env.db, o.mosqueId, env.clock.now)).toBeNull(); // 14 days left
    env.clock.set('2026-10-19T05:00:00.000Z'); // 6 days left
    const tv = await pairTv(env, o.token, o.mosqueId);
    const snap = await request(env.app)
      .get('/api/tv/snapshot')
      .set('Authorization', `Device ${tv}`)
      .expect(200);
    expect(snap.body.snapshot.version).toBe(2);
    expect(snap.body.snapshot.days).toHaveLength(14);
    expect(snap.body.snapshot.days[0].date).toBe('2026-10-19');
    expect(snap.body.snapshot.days[13].date).toBe('2026-11-01');
    expect(snap.body.snapshot.days[13].prayers[4].iqamah).not.toBe('21:45');
    expect(snap.body.snapshot.announcements).toEqual([]);
    const status = await request(env.app).get(`${o.m}/publish/status`).set(auth(o.token)).expect(200);
    expect(status.body.hasUnpublishedChanges).toBe(true);
    const audit = await request(env.app).get(`${o.m}/audit?limit=1`).set(auth(o.token)).expect(200);
    expect(audit.body[0]).toMatchObject({ action: 'snapshot.auto_refresh', userEmail: null });
    expect(refreshAllSnapshots(env.db, env.clock.now)).toBe(0);
  });

  it('does not refresh while paused', async () => {
    const o = await calculatedMosque();
    await request(env.app).post(`${o.m}/publish`).set(auth(o.token)).expect(201);
    await request(env.app).post(`${o.m}/pause`).set(auth(o.token)).send({ paused: true }).expect(200);
    env.clock.set('2026-10-22T05:00:00.000Z');
    expect(refreshAllSnapshots(env.db, env.clock.now)).toBe(0);
  });
});

describe('TV API CORS (Android app loads the page from bundled assets)', () => {
  it('answers preflight and sets CORS headers on device endpoints only', async () => {
    const pre = await request(env.app)
      .options('/api/tv/snapshot')
      .set('Origin', 'https://appassets.androidplatform.net')
      .expect(204);
    expect(pre.headers['access-control-allow-origin']).toBe('*');
    expect(pre.headers['access-control-allow-headers']).toContain('Authorization');
    const pair = await request(env.app).post('/api/tv/pairing').expect(201);
    expect(pair.headers['access-control-allow-origin']).toBe('*');
    const login = await request(env.app)
      .post('/api/auth/login')
      .send({ email: 'x@example.com', password: 'nope' });
    expect(login.headers['access-control-allow-origin']).toBeUndefined();
  });
});

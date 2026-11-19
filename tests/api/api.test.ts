import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { openDatabase } from '../../src/db/db.js';
import request from 'supertest';
import {
  DAY,
  type TestEnv,
  auth,
  makeEnv,
  pairTv,
  registerMosque,
  inviteAndAccept,
  tokenFromLastEmail,
} from '../helpers.js';

let env: TestEnv;
beforeEach(() => {
  env = makeEnv();
});

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

describe('health & auth', () => {
  it('health endpoint reports ok', async () => {
    const res = await request(env.app).get('/api/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'ok' });
  });

  it('registers, logs in, and returns memberships; passwords are hashed', async () => {
    const { email, mosqueId } = await registerMosque(env);
    const login = await request(env.app)
      .post('/api/auth/login')
      .send({ email, password: 'password123' })
      .expect(200);
    const me = await request(env.app).get('/api/me').set(auth(login.body.token)).expect(200);
    expect(me.body.mosques).toEqual([expect.objectContaining({ id: mosqueId, role: 'owner' })]);
    const row = env.db.prepare('SELECT password_hash FROM users WHERE email = ?').get(email) as {
      password_hash: string;
    };
    expect(row.password_hash).toMatch(/^\$2[aby]\$10\$/);
    expect(row.password_hash).not.toContain('password123');
  });

  it('rejects bad credentials, duplicate emails, weak passwords and bad timezones', async () => {
    const { email } = await registerMosque(env);
    await request(env.app).post('/api/auth/login').send({ email, password: 'nope-nope' }).expect(401);
    await request(env.app)
      .post('/api/auth/register')
      .send({ name: 'X', email, password: 'password123', mosqueName: 'Y', timezone: 'UTC' })
      .expect(409);
    await request(env.app)
      .post('/api/auth/register')
      .send({ name: 'X', email: 'new@example.com', password: 'short', mosqueName: 'Y', timezone: 'UTC' })
      .expect(400);
    await request(env.app)
      .post('/api/auth/register')
      .send({
        name: 'X',
        email: 'new2@example.com',
        password: 'password123',
        mosqueName: 'Y',
        timezone: 'Nowhere/Land',
      })
      .expect(400);
  });

  it('requires a valid token for mosque routes', async () => {
    const { mosqueId } = await registerMosque(env);
    await request(env.app).get(`/api/mosques/${mosqueId}/today`).expect(401);
    await request(env.app).get(`/api/mosques/${mosqueId}/today`).set(auth('garbage')).expect(401);
  });

  it('changes password', async () => {
    const { token, email } = await registerMosque(env);
    await request(env.app)
      .post('/api/me/password')
      .set(auth(token))
      .send({ currentPassword: 'wrong', newPassword: 'newpassword1' })
      .expect(400);
    await request(env.app)
      .post('/api/me/password')
      .set(auth(token))
      .send({ currentPassword: 'password123', newPassword: 'newpassword1' })
      .expect(200);
    await request(env.app).post('/api/auth/login').send({ email, password: 'newpassword1' }).expect(200);
  });
});

describe('main journey: register -> prayer times -> publish -> pair TV -> snapshot', () => {
  it('works end to end, with change detection', async () => {
    const { token, mosqueId } = await registerMosque(env);
    const m = `/api/mosques/${mosqueId}`;
    await request(env.app).put(`${m}/prayers/2026-10-11`).set(auth(token)).send(DAY).expect(200);
    let status = await request(env.app).get(`${m}/publish/status`).set(auth(token)).expect(200);
    expect(status.body.hasUnpublishedChanges).toBe(true);
    const pub = await request(env.app).post(`${m}/publish`).set(auth(token)).expect(201);
    expect(pub.body.version).toBe(1);
    status = await request(env.app).get(`${m}/publish/status`).set(auth(token)).expect(200);
    expect(status.body).toMatchObject({ hasUnpublishedChanges: false, lastPublished: { version: 1 } });

    const deviceToken = await pairTv(env, token, mosqueId);
    expect(deviceToken).toBeTruthy();
    const snap = await request(env.app)
      .get('/api/tv/snapshot')
      .set('Authorization', `Device ${deviceToken}`)
      .expect(200);
    expect(snap.body.snapshot.version).toBe(1);
    expect(snap.body.snapshot.days[0]).toMatchObject({ date: '2026-10-11' });
    expect(snap.body.snapshot.days[0].prayers[1]).toMatchObject({
      key: 'dhuhr',
      adhan: '12:30',
      iqamah: '13:00',
    });

    const same = await request(env.app)
      .get('/api/tv/snapshot?version=1')
      .set('Authorization', `Device ${deviceToken}`)
      .expect(200);
    expect(same.body).toEqual({ unchanged: true, version: 1, paused: false });

    // Draft edits are NOT visible to the TV until published.
    await request(env.app)
      .patch(`${m}/prayers/2026-10-11/iqamah`)
      .set(auth(token))
      .send({ prayer: 'isha', iqamah: '20:00', todayOnly: true })
      .expect(200);
    const still = await request(env.app)
      .get('/api/tv/snapshot?version=1')
      .set('Authorization', `Device ${deviceToken}`)
      .expect(200);
    expect(still.body.unchanged).toBe(true);
    await request(env.app).post(`${m}/publish`).set(auth(token)).expect(201);
    const updated = await request(env.app)
      .get('/api/tv/snapshot?version=1')
      .set('Authorization', `Device ${deviceToken}`)
      .expect(200);
    expect(updated.body.snapshot.version).toBe(2);
    expect(updated.body.snapshot.days[0].prayers[4]).toMatchObject({ iqamah: '20:00', overridden: true });
    expect(updated.body.snapshot.days[1].prayers[4].iqamah).toBe('19:45');

    const devices = await request(env.app).get(`${m}/devices`).set(auth(token)).expect(200);
    expect(devices.body[0]).toMatchObject({
      name: 'Hall TV',
      online: true,
      upToDate: true,
      snapshotVersion: 2,
    });

    const today = await request(env.app).get(`${m}/today`).set(auth(token)).expect(200);
    expect(today.body.nextEvent).toMatchObject({ type: 'adhan', at: '12:30' }); // clock is 09:00 UTC
  });

  it('returns snapshot:null for a paired TV before the first publish', async () => {
    const { token, mosqueId } = await registerMosque(env);
    const deviceToken = await pairTv(env, token, mosqueId);
    const res = await request(env.app)
      .get('/api/tv/snapshot')
      .set('Authorization', `Device ${deviceToken}`)
      .expect(200);
    expect(res.body.snapshot).toBeNull();
  });

  it('rejects publishing with no prayer times', async () => {
    const { token, mosqueId } = await registerMosque(env);
    await request(env.app).post(`/api/mosques/${mosqueId}/publish`).set(auth(token)).expect(409);
  });
});

describe('pairing via API', () => {
  it('expires codes after 10 minutes', async () => {
    const { token, mosqueId } = await registerMosque(env);
    const p = await request(env.app).post('/api/tv/pairing').expect(201);
    expect(p.body.code).toMatch(/^\d{5}$/);
    env.clock.advance(10 * 60 * 1000 + 1);
    await request(env.app)
      .post(`/api/mosques/${mosqueId}/devices/pair`)
      .set(auth(token))
      .send({ code: p.body.code })
      .expect(410);
    const s = await request(env.app)
      .get(`/api/tv/pairing/${p.body.pairingId}`)
      .set('X-Pairing-Secret', p.body.pairingSecret);
    expect(s.body).toEqual({ status: 'expired' });
  });

  it('codes are one-time use, even across mosques', async () => {
    const a = await registerMosque(env);
    const b = await registerMosque(env);
    const p = await request(env.app).post('/api/tv/pairing').expect(201);
    await request(env.app)
      .post(`/api/mosques/${a.mosqueId}/devices/pair`)
      .set(auth(a.token))
      .send({ code: p.body.code })
      .expect(201);
    await request(env.app)
      .post(`/api/mosques/${a.mosqueId}/devices/pair`)
      .set(auth(a.token))
      .send({ code: p.body.code })
      .expect(404);
    await request(env.app)
      .post(`/api/mosques/${b.mosqueId}/devices/pair`)
      .set(auth(b.token))
      .send({ code: p.body.code })
      .expect(404);
  });

  it('polling requires the pairing secret and delivers the token only once', async () => {
    const { token, mosqueId } = await registerMosque(env);
    const p = await request(env.app).post('/api/tv/pairing').expect(201);
    await request(env.app).get(`/api/tv/pairing/${p.body.pairingId}`).expect(401);
    await request(env.app)
      .get(`/api/tv/pairing/${p.body.pairingId}`)
      .set('X-Pairing-Secret', 'wrong')
      .expect(404);
    const pending = await request(env.app)
      .get(`/api/tv/pairing/${p.body.pairingId}`)
      .set('X-Pairing-Secret', p.body.pairingSecret);
    expect(pending.body.status).toBe('pending');
    await request(env.app)
      .post(`/api/mosques/${mosqueId}/devices/pair`)
      .set(auth(token))
      .send({ code: p.body.code })
      .expect(201);
    const first = await request(env.app)
      .get(`/api/tv/pairing/${p.body.pairingId}`)
      .set('X-Pairing-Secret', p.body.pairingSecret);
    expect(first.body.status).toBe('paired');
    const second = await request(env.app)
      .get(`/api/tv/pairing/${p.body.pairingId}`)
      .set('X-Pairing-Secret', p.body.pairingSecret);
    expect(second.body).toEqual({ status: 'consumed' });
  });

  it('revoked devices lose access', async () => {
    const { token, mosqueId } = await registerMosque(env);
    const deviceToken = await pairTv(env, token, mosqueId);
    const devices = await request(env.app).get(`/api/mosques/${mosqueId}/devices`).set(auth(token));
    await request(env.app)
      .delete(`/api/mosques/${mosqueId}/devices/${devices.body[0].id}`)
      .set(auth(token))
      .expect(200);
    await request(env.app).get('/api/tv/snapshot').set('Authorization', `Device ${deviceToken}`).expect(401);
    await request(env.app).get('/api/tv/snapshot').expect(401);
  });
});

describe('tenant isolation', () => {
  it('users cannot read or modify another mosque', async () => {
    const a = await registerMosque(env);
    const b = await registerMosque(env);
    const mb = `/api/mosques/${b.mosqueId}`;
    for (const path of [
      '',
      '/today',
      '/prayers',
      '/announcements',
      '/slides',
      '/jummah',
      '/devices',
      '/users',
      '/audit',
      '/preview',
    ]) {
      await request(env.app)
        .get(mb + path)
        .set(auth(a.token))
        .expect(403);
    }
    await request(env.app).put(`${mb}/prayers/2026-10-11`).set(auth(a.token)).send(DAY).expect(403);
    await request(env.app).post(`${mb}/publish`).set(auth(a.token)).expect(403);
    await request(env.app)
      .post(`${mb}/announcements`)
      .set(auth(a.token))
      .send({ title: 'x', startDate: '2026-10-11', endDate: '2026-10-11' })
      .expect(403);
  });

  it('resource ids from another mosque are not reachable through your own mosque path', async () => {
    const a = await registerMosque(env);
    const b = await registerMosque(env);
    const created = await request(env.app)
      .post(`/api/mosques/${b.mosqueId}/announcements`)
      .set(auth(b.token))
      .send({ title: 'B only', startDate: '2026-10-11', endDate: '2026-10-12' })
      .expect(201);
    const ma = `/api/mosques/${a.mosqueId}`;
    await request(env.app)
      .put(`${ma}/announcements/${created.body.id}`)
      .set(auth(a.token))
      .send({ title: 'hacked', startDate: '2026-10-11', endDate: '2026-10-12' })
      .expect(404);
    await request(env.app).delete(`${ma}/announcements/${created.body.id}`).set(auth(a.token)).expect(404);
    const listA = await request(env.app).get(`${ma}/announcements`).set(auth(a.token)).expect(200);
    expect(listA.body).toEqual([]);
  });

  it("a TV only ever receives its own mosque's snapshot", async () => {
    const a = await registerMosque(env, { mosqueName: 'Alpha' });
    const b = await registerMosque(env, { mosqueName: 'Beta' });
    for (const x of [a, b]) {
      await request(env.app)
        .put(`/api/mosques/${x.mosqueId}/prayers/2026-10-11`)
        .set(auth(x.token))
        .send(DAY)
        .expect(200);
      await request(env.app).post(`/api/mosques/${x.mosqueId}/publish`).set(auth(x.token)).expect(201);
    }
    const tvA = await pairTv(env, a.token, a.mosqueId);
    const res = await request(env.app)
      .get('/api/tv/snapshot')
      .set('Authorization', `Device ${tvA}`)
      .expect(200);
    expect(res.body.snapshot.mosque.name).toBe('Alpha');
    const devB = await request(env.app)
      .get(`/api/mosques/${b.mosqueId}/devices`)
      .set(auth(b.token))
      .expect(200);
    expect(devB.body).toEqual([]);
  });
});

describe('role enforcement', () => {
  async function withEditor() {
    const owner = await registerMosque(env);
    const m = `/api/mosques/${owner.mosqueId}`;
    const ed = await inviteAndAccept(env, owner.token, owner.mosqueId, 'ed@example.com', 'editor');
    return { owner, m, editorToken: ed.token };
  }

  it('editors can edit content and publish', async () => {
    const { m, editorToken } = await withEditor();
    await request(env.app).put(`${m}/prayers/2026-10-11`).set(auth(editorToken)).send(DAY).expect(200);
    await request(env.app)
      .post(`${m}/announcements`)
      .set(auth(editorToken))
      .send({ title: 'Hi', startDate: '2026-10-11', endDate: '2026-10-11' })
      .expect(201);
    await request(env.app).post(`${m}/publish`).set(auth(editorToken)).expect(201);
  });

  it('editors cannot manage devices, users, pause, settings or view audit', async () => {
    const { m, editorToken } = await withEditor();
    await request(env.app).get(`${m}/devices`).set(auth(editorToken)).expect(403);
    await request(env.app)
      .post(`${m}/devices/pair`)
      .set(auth(editorToken))
      .send({ code: '12345' })
      .expect(403);
    await request(env.app).get(`${m}/users`).set(auth(editorToken)).expect(403);
    await request(env.app)
      .post(`${m}/users`)
      .set(auth(editorToken))
      .send({ email: 'x@example.com', name: 'X', role: 'editor' })
      .expect(403);
    await request(env.app).post(`${m}/pause`).set(auth(editorToken)).send({ paused: true }).expect(403);
    await request(env.app).patch(m).set(auth(editorToken)).send({ name: 'Renamed' }).expect(403);
    await request(env.app).get(`${m}/audit`).set(auth(editorToken)).expect(403);
  });

  it('admins can add editors but cannot grant admin/owner; owners can', async () => {
    const owner = await registerMosque(env);
    const m = `/api/mosques/${owner.mosqueId}`;
    const adminToken = (await inviteAndAccept(env, owner.token, owner.mosqueId, 'ad@example.com', 'admin'))
      .token;
    const inv = await request(env.app)
      .post(`${m}/users`)
      .set(auth(adminToken))
      .send({ email: 'e2@example.com', name: 'E2', role: 'editor' })
      .expect(201);
    expect(inv.body).toMatchObject({ status: 'invited', emailSent: true });
    expect(inv.body.tempPassword).toBeUndefined();
    const accepted = await request(env.app)
      .post('/api/auth/accept-invite')
      .send({ token: tokenFromLastEmail(env, 'e2@example.com'), password: 'password123' })
      .expect(201);
    const ed = { body: { id: accepted.body.user.id } };
    await request(env.app)
      .post(`${m}/users`)
      .set(auth(adminToken))
      .send({ email: 'a2@example.com', name: 'A2', role: 'admin' })
      .expect(403);
    await request(env.app)
      .patch(`${m}/users/${ed.body.id}`)
      .set(auth(adminToken))
      .send({ role: 'admin' })
      .expect(403);
    await request(env.app)
      .patch(`${m}/users/${owner.userId}`)
      .set(auth(adminToken))
      .send({ role: 'editor' })
      .expect(403);
    await request(env.app).delete(`${m}/users/${owner.userId}`).set(auth(adminToken)).expect(403);
    await request(env.app)
      .patch(`${m}/users/${ed.body.id}`)
      .set(auth(owner.token))
      .send({ role: 'admin' })
      .expect(200);
    await request(env.app)
      .post(`${m}/users`)
      .set(auth(owner.token))
      .send({ email: 'e2@example.com', role: 'editor' })
      .expect(409);
    await request(env.app).delete(`${m}/users/${ed.body.id}`).set(auth(owner.token)).expect(200);
    const users = await request(env.app).get(`${m}/users`).set(auth(adminToken)).expect(200);
    expect(users.body.map((u: { role: string }) => u.role).sort()).toEqual(['admin', 'owner']);
  });

  it('the last owner cannot be demoted or removed', async () => {
    const owner = await registerMosque(env);
    const m = `/api/mosques/${owner.mosqueId}`;
    await request(env.app)
      .patch(`${m}/users/${owner.userId}`)
      .set(auth(owner.token))
      .send({ role: 'admin' })
      .expect(400);
    await request(env.app).delete(`${m}/users/${owner.userId}`).set(auth(owner.token)).expect(400);
  });
});

describe('announcements', () => {
  it('reports status and auto-expires from the TV snapshot', async () => {
    const { token, mosqueId } = await registerMosque(env);
    const m = `/api/mosques/${mosqueId}`;
    await request(env.app).put(`${m}/prayers/2026-10-11`).set(auth(token)).send(DAY).expect(200);
    const mk = (title: string, startDate: string, endDate: string) =>
      request(env.app)
        .post(`${m}/announcements`)
        .set(auth(token))
        .send({ title, startDate, endDate })
        .expect(201);
    await mk('Past', '2026-10-01', '2026-10-10');
    await mk('Today', '2026-10-11', '2026-10-11');
    await mk('Future', '2026-10-20', '2026-10-22');
    const list = await request(env.app).get(`${m}/announcements`).set(auth(token)).expect(200);
    const byTitle = Object.fromEntries(
      list.body.map((a: { title: string; status: string }) => [a.title, a.status]),
    );
    expect(byTitle).toEqual({ Past: 'expired', Today: 'active', Future: 'scheduled' });
    const active = await request(env.app)
      .get(`${m}/announcements?status=active`)
      .set(auth(token))
      .expect(200);
    expect(active.body).toHaveLength(1);

    const pub = await request(env.app).post(`${m}/publish`).set(auth(token)).expect(201);
    expect(pub.body.snapshot.announcements.map((a: { title: string }) => a.title)).toEqual([
      'Today',
      'Future',
    ]);

    // Next day: "Today" has expired and drops out of the next published snapshot.
    env.clock.set('2026-10-12T09:00:00Z');
    const pub2 = await request(env.app).post(`${m}/publish`).set(auth(token)).expect(201);
    expect(pub2.body.snapshot.announcements.map((a: { title: string }) => a.title)).toEqual(['Future']);
  });

  it('validates date ranges and supports edit/delete', async () => {
    const { token, mosqueId } = await registerMosque(env);
    const m = `/api/mosques/${mosqueId}`;
    await request(env.app)
      .post(`${m}/announcements`)
      .set(auth(token))
      .send({ title: 'Bad', startDate: '2026-10-12', endDate: '2026-10-11' })
      .expect(400);
    const a = await request(env.app)
      .post(`${m}/announcements`)
      .set(auth(token))
      .send({ title: 'A', startDate: '2026-10-11', endDate: '2026-10-11' })
      .expect(201);
    await request(env.app)
      .put(`${m}/announcements/${a.body.id}`)
      .set(auth(token))
      .send({ title: 'A2', body: 'x', startDate: '2026-10-11', endDate: '2026-10-13' })
      .expect(200);
    await request(env.app).delete(`${m}/announcements/${a.body.id}`).set(auth(token)).expect(200);
    await request(env.app).delete(`${m}/announcements/${a.body.id}`).set(auth(token)).expect(404);
  });
});

describe('prayer schedule API', () => {
  it('validates input, lists carried-forward days and clears overrides', async () => {
    const { token, mosqueId } = await registerMosque(env);
    const m = `/api/mosques/${mosqueId}`;
    await request(env.app)
      .put(`${m}/prayers/2026-10-11`)
      .set(auth(token))
      .send({ ...DAY, asr: { adhan: '15:45', iqamah: '15:00' } })
      .expect(400);
    await request(env.app).put(`${m}/prayers/2026-13-01`).set(auth(token)).send(DAY).expect(400);
    await request(env.app)
      .put(`${m}/prayers/2026-10-11`)
      .set(auth(token))
      .send({ fajr: DAY.fajr })
      .expect(400);
    await request(env.app).put(`${m}/prayers/2026-10-11`).set(auth(token)).send(DAY).expect(200);
    await request(env.app)
      .patch(`${m}/prayers/2026-10-11/iqamah`)
      .set(auth(token))
      .send({ prayer: 'asr', iqamah: '16:15', todayOnly: true })
      .expect(200);
    const list = await request(env.app).get(`${m}/prayers?days=3`).set(auth(token)).expect(200);
    expect(list.body.today).toBe('2026-10-11');
    expect(list.body.days).toHaveLength(3);
    expect(list.body.days[0]).toMatchObject({
      explicit: true,
      overrides: [{ prayer: 'asr', iqamah: '16:15' }],
    });
    expect(list.body.days[2]).toMatchObject({ explicit: false, sourceDate: '2026-10-11' });
    const cleared = await request(env.app)
      .delete(`${m}/prayers/2026-10-11/overrides`)
      .set(auth(token))
      .expect(200);
    expect(cleared.body.removed).toBe(1);
  });
});

describe('jummah', () => {
  it('CRUD and inclusion in snapshot', async () => {
    const { token, mosqueId } = await registerMosque(env);
    const m = `/api/mosques/${mosqueId}`;
    await request(env.app)
      .post(`${m}/jummah`)
      .set(auth(token))
      .send({ label: 'X', khutbah: '13:00', iqamah: '12:00' })
      .expect(400);
    const j = await request(env.app)
      .post(`${m}/jummah`)
      .set(auth(token))
      .send({ label: '1st', khutbah: '12:45', iqamah: '13:15' })
      .expect(201);
    await request(env.app)
      .put(`${m}/jummah/${j.body.id}`)
      .set(auth(token))
      .send({ label: '1st Jumuah', khutbah: '12:50', iqamah: '13:20', language: 'English' })
      .expect(200);
    await request(env.app)
      .put(`${m}/jummah/99999`)
      .set(auth(token))
      .send({ label: 'n', khutbah: '12:50', iqamah: '13:20' })
      .expect(404);
    await request(env.app).put(`${m}/prayers/2026-10-11`).set(auth(token)).send(DAY).expect(200);
    const pub = await request(env.app).post(`${m}/publish`).set(auth(token)).expect(201);
    expect(pub.body.snapshot.jummah).toEqual([
      { label: '1st Jumuah', khutbah: '12:50', iqamah: '13:20', language: 'English' },
    ]);
    await request(env.app).delete(`${m}/jummah/${j.body.id}`).set(auth(token)).expect(200);
    await request(env.app).delete(`${m}/jummah/${j.body.id}`).set(auth(token)).expect(404);
  });
});

describe('slides', () => {
  it('uploads images within the size limit and serves them', async () => {
    const { token, mosqueId } = await registerMosque(env);
    const m = `/api/mosques/${mosqueId}`;
    const up = await request(env.app)
      .post(`${m}/slides`)
      .set(auth(token))
      .field('caption', 'Eid')
      .field('durationSec', '8')
      .attach('image', PNG, { filename: 'a.png', contentType: 'image/png' })
      .expect(201);
    expect(up.body).toMatchObject({ caption: 'Eid', durationSec: 8, active: true, mime: 'image/png' });
    await request(env.app)
      .get(up.body.url)
      .expect(200)
      .expect('Content-Type', /image\/png/);
    await request(env.app)
      .patch(`${m}/slides/${up.body.id}`)
      .set(auth(token))
      .send({ active: false })
      .expect(200);
    await request(env.app).put(`${m}/prayers/2026-10-11`).set(auth(token)).send(DAY).expect(200);
    let pub = await request(env.app).post(`${m}/publish`).set(auth(token)).expect(201);
    expect(pub.body.snapshot.slides).toEqual([]);
    await request(env.app)
      .patch(`${m}/slides/${up.body.id}`)
      .set(auth(token))
      .send({ active: true })
      .expect(200);
    pub = await request(env.app).post(`${m}/publish`).set(auth(token)).expect(201);
    expect(pub.body.snapshot.slides).toHaveLength(1);
    await request(env.app).delete(`${m}/slides/${up.body.id}`).set(auth(token)).expect(200);
    const list = await request(env.app).get(`${m}/slides`).set(auth(token)).expect(200);
    expect(list.body).toEqual([]);
  });

  it('rejects oversize files, non-images and missing files', async () => {
    const { token, mosqueId } = await registerMosque(env);
    const m = `/api/mosques/${mosqueId}`;
    const big = Buffer.alloc(60_000, 1); // limit in tests is 50 KB
    await request(env.app)
      .post(`${m}/slides`)
      .set(auth(token))
      .attach('image', big, { filename: 'big.png', contentType: 'image/png' })
      .expect(413);
    await request(env.app)
      .post(`${m}/slides`)
      .set(auth(token))
      .attach('image', Buffer.from('hello'), { filename: 'x.txt', contentType: 'text/plain' })
      .expect(400);
    await request(env.app).post(`${m}/slides`).set(auth(token)).field('caption', 'none').expect(400);
    await request(env.app)
      .post(`${m}/slides`)
      .set(auth(token))
      .field('durationSec', '1')
      .attach('image', PNG, { filename: 'a.png', contentType: 'image/png' })
      .expect(400);
  });
});

describe('emergency pause', () => {
  it('blocks publish and keeps the TV on the last approved snapshot', async () => {
    const { token, mosqueId } = await registerMosque(env);
    const m = `/api/mosques/${mosqueId}`;
    await request(env.app).put(`${m}/prayers/2026-10-11`).set(auth(token)).send(DAY).expect(200);
    await request(env.app).post(`${m}/publish`).set(auth(token)).expect(201);
    const tv = await pairTv(env, token, mosqueId);
    const paused = await request(env.app)
      .post(`${m}/pause`)
      .set(auth(token))
      .send({ paused: true })
      .expect(200);
    expect(paused.body.paused).toBe(true);
    await request(env.app).post(`${m}/publish`).set(auth(token)).expect(409);
    const snap = await request(env.app)
      .get('/api/tv/snapshot')
      .set('Authorization', `Device ${tv}`)
      .expect(200);
    expect(snap.body).toMatchObject({ paused: true, snapshot: { version: 1 } });
    await request(env.app).post(`${m}/pause`).set(auth(token)).send({ paused: false }).expect(200);
    await request(env.app).post(`${m}/publish`).set(auth(token)).expect(201);
  });
});

describe('audit log & settings', () => {
  it('records actions and exposes them read-only to admins', async () => {
    const { token, mosqueId } = await registerMosque(env);
    const m = `/api/mosques/${mosqueId}`;
    await request(env.app)
      .patch(m)
      .set(auth(token))
      .send({ name: 'Renamed Mosque', timezone: 'Europe/London' })
      .expect(200);
    await request(env.app).patch(m).set(auth(token)).send({ timezone: 'Bad/Zone' }).expect(400);
    const info = await request(env.app).get(m).set(auth(token)).expect(200);
    expect(info.body).toMatchObject({ name: 'Renamed Mosque', timezone: 'Europe/London', role: 'owner' });
    await request(env.app).put(`${m}/prayers/2026-10-11`).set(auth(token)).send(DAY).expect(200);
    await request(env.app).post(`${m}/publish`).set(auth(token)).expect(201);
    const audit = await request(env.app).get(`${m}/audit`).set(auth(token)).expect(200);
    expect(audit.body.map((a: { action: string }) => a.action)).toEqual([
      'snapshot.publish',
      'prayers.update',
      'mosque.update',
      'mosque.register',
    ]);
    expect(audit.body[0].userEmail).toContain('@example.com');
    // There is no API to modify or delete audit entries.
    await request(env.app).delete(`${m}/audit`).set(auth(token)).expect(404);
  });

  it('preview returns the unpublished draft payload', async () => {
    const { token, mosqueId } = await registerMosque(env);
    const m = `/api/mosques/${mosqueId}`;
    await request(env.app).put(`${m}/prayers/2026-10-11`).set(auth(token)).send(DAY).expect(200);
    const prev = await request(env.app).get(`${m}/preview`).set(auth(token)).expect(200);
    expect(prev.body).toMatchObject({ preview: true, version: 0 });
    expect(prev.body.days).toHaveLength(14);
  });

  it('returns JSON 404 for unknown API routes and 400 for bad JSON', async () => {
    await request(env.app).get('/api/nope').expect(404);
    await request(env.app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{bad')
      .expect(400);
    await request(env.app).get('/api/mosques/abc/today').set(auth('x')).expect(401);
  });
});

describe('static surfaces', () => {
  it('serves admin, TV and public pages', async () => {
    await request(env.app).get('/').expect(200).expect('Content-Type', /html/);
    await request(env.app).get('/admin/').expect(200).expect('Content-Type', /html/);
    await request(env.app).get('/tv/').expect(200).expect('Content-Type', /html/);
    await request(env.app).get('/admin/manifest.webmanifest').expect(200);
  });
});

describe('HTTPS_REDIRECT (old TVs may use plain HTTP for /tv only)', () => {
  const app = () => createApp(openDatabase(':memory:'), { httpsRedirect: true, trustProxy: true });

  it('redirects admin pages to HTTPS and refuses plain-HTTP API writes', async () => {
    const res = await request(app()).get('/admin/').set('X-Forwarded-Proto', 'http').expect(308);
    expect(res.headers.location).toMatch(/^https:\/\/[^/]+\/admin\/$/);
    await request(app())
      .post('/api/auth/login')
      .set('X-Forwarded-Proto', 'http')
      .send({ email: 'a@b.c', password: 'x' })
      .expect(403);
  });

  it('serves the TV display, its API and assets over plain HTTP', async () => {
    const a = app();
    await request(a).get('/tv/').set('X-Forwarded-Proto', 'http').expect(200);
    await request(a).get('/tv/app.css').set('X-Forwarded-Proto', 'http').expect(404); // not redirected
    await request(a).post('/api/tv/pairing').set('X-Forwarded-Proto', 'http').expect(201);
    await request(a).get('/api/health').set('X-Forwarded-Proto', 'http').expect(200);
    await request(a).get('/brand/logo.png').set('X-Forwarded-Proto', 'http').expect(200);
  });

  it('passes HTTPS requests through', async () => {
    await request(app()).get('/admin/').set('X-Forwarded-Proto', 'https').expect(200);
  });
});

// Manual browser E2E (not part of npm test): needs puppeteer-core + Chrome, a running server and the seeded demo user.
// Usage: npm i --no-save puppeteer-core && BASE=http://localhost:3000 node scripts/browser-e2e.mjs
import puppeteer from 'puppeteer-core';
const BASE = process.env.BASE ?? 'http://localhost:3000';
const out = process.env.OUT ?? 'docs/screenshots';
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox'],
});
const errors = [];
const watch = (p, name) => {
  p.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  p.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`);
  });
};
const tvCtx = await browser.createBrowserContext();
const tv = await tvCtx.newPage();
watch(tv, 'tv');
await tv.setViewport({ width: 1920, height: 1080 });
await tv.goto(`${BASE}/tv/`, { waitUntil: 'networkidle0' });
await tv.waitForFunction(() => /^\d{5}$/.test(document.getElementById('pair-code').textContent));
const code = await tv.$eval('#pair-code', (e) => e.textContent);
await tv.bringToFront();
await tv.screenshot({ path: `${out}/tv-pairing.png` });
console.log('TV code', code);

const adminCtx = await browser.createBrowserContext();
const ad = await adminCtx.newPage();
watch(ad, 'admin');
await ad.setViewport({ width: 1280, height: 900 });
await ad.goto(`${BASE}/admin/`, { waitUntil: 'networkidle0' });
await ad.bringToFront();
await ad.screenshot({ path: `${out}/admin-login.png` });
await ad.type('input[name=email]', 'demo@masjidpulse.local');
await ad.type('input[name=password]', 'demo-password-123');
await ad.click('button.big');
await ad.waitForSelector('#publish');
await ad.goto(`${BASE}/admin/#/devices`);
await ad.waitForSelector('input[name=code]');
await ad.type('input[name=code]', code);
await ad.click('#f button');
await ad.waitForFunction(() =>
  document.querySelector('#view table td')?.textContent.includes('Prayer Hall TV'),
);
// Automatic prayer times: set location + method in the Prayer times screen, check live preview, save.
await ad.goto(`${BASE}/admin/#/prayers`);
await ad.waitForSelector('#calc');
const setVal = (sel, v) =>
  ad.$eval(
    sel,
    (e, val) => {
      e.value = val;
      e.dispatchEvent(new Event('change', { bubbles: true }));
    },
    v,
  );
await setVal('[name=latitude]', process.env.E2E_LAT ?? '56.7267');
await setVal('[name=longitude]', process.env.E2E_LON ?? '-111.3810');
await setVal('[name=timezone]', process.env.E2E_TZ ?? 'America/Edmonton');
await setVal('[name=method]', 'ISNA');
await ad.waitForFunction(() => document.querySelectorAll('#preview tr').length >= 6, { timeout: 10000 });
const preview = await ad.$$eval('#preview tbody tr', (rows) =>
  rows.map((r) => r.innerText.replace(/\s+/g, ' ')),
);
console.log('preview', JSON.stringify(preview));
await ad.bringToFront();
await ad.screenshot({ path: `${out}/admin-prayers-auto.png`, fullPage: true });
await ad.click('#save-calc');
await ad.waitForFunction(
  () => document.querySelector('#view p.muted')?.innerHTML.includes('calculated automatically'),
  {
    timeout: 10000,
  },
);
console.log('automatic times saved');
await ad.goto(`${BASE}/admin/#/today`);
await ad.waitForSelector('#publish');
await ad.click('#publish');
await ad.waitForFunction(() => document.querySelector('.status.ok'), { timeout: 10000 });
console.log('published');
await new Promise((r) => setTimeout(r, 4500));
// TV polls every 30 s; reload so it fetches the new version now. Retry: the page may be navigating
// (e.g. service worker activation) at the same moment, which detaches the frame.
for (let attempt = 1; ; attempt++) {
  try {
    await tv.goto(`${BASE}/tv/`, { waitUntil: 'networkidle0' });
    await tv.waitForSelector('#display:not([hidden])', { timeout: 15000 });
    break;
  } catch (e) {
    if (attempt >= 3) throw e;
    console.log('tv reload retry', attempt, e.message);
    await new Promise((r) => setTimeout(r, 1000));
  }
}
await new Promise((r) => setTimeout(r, 1500));
await tv.bringToFront();
await tv.screenshot({ path: `${out}/tv-display.png` });
console.log('tv display shot');
await ad.goto(`${BASE}/admin/#/today`);
await ad.waitForSelector('#publish');
await new Promise((r) => setTimeout(r, 500));
await ad.bringToFront();
await ad.screenshot({ path: `${out}/admin-today.png`, fullPage: true });
const mob = await adminCtx.newPage();
watch(mob, 'mobile');
await mob.setViewport({ width: 390, height: 844, isMobile: true });
await mob.goto(`${BASE}/admin/#/today`, { waitUntil: 'networkidle0' });
await mob.waitForSelector('#publish');
await mob.bringToFront();
await mob.screenshot({ path: `${out}/admin-mobile.png`, fullPage: true });
for (const r of ['prayers', 'jummah', 'announcements', 'slides', 'users', 'audit', 'settings']) {
  console.log('route', r);
  await ad.evaluate((h) => {
    location.hash = h;
  }, '#/' + r);
  await new Promise((res) => setTimeout(res, 600));
  const bad = await ad.$('.status.bad');
  if (bad) errors.push(`admin ${r}: ` + (await bad.evaluate((e) => e.textContent)));
}
await ad.evaluate(() => {
  location.hash = '#/prayers';
});
await new Promise((res) => setTimeout(res, 1200));
await ad.bringToFront();
await ad.screenshot({ path: `${out}/admin-prayers.png` });
console.log('prayers shot');
// Invite a volunteer by email (dev outbox when SMTP is not configured)
await ad.evaluate(() => {
  location.hash = '#/users';
});
await ad.waitForSelector('#f [name=email]');
await ad.type('#f [name=email]', `volunteer-${Date.now()}@example.com`);
await ad.type('#f [name=name]', 'New Volunteer');
await ad.click('#f button');
await ad.waitForFunction(() => document.body.innerText.includes('Pending invitations'), { timeout: 10000 });
await ad.bringToFront();
await ad.screenshot({ path: `${out}/admin-users-invite.png` });
console.log('invite shot');
// Public auth pages
const pub = await (await browser.createBrowserContext()).newPage();
watch(pub, 'public');
await pub.setViewport({ width: 1280, height: 900 });
await pub.goto(`${BASE}/admin/#/forgot`, { waitUntil: 'networkidle0' });
await pub.type('input[name=email]', 'demo@masjidpulse.local');
await pub.click('button.big');
await pub.waitForFunction(() => document.body.innerText.includes('Check your email'));
await pub.bringToFront();
await pub.screenshot({ path: `${out}/admin-forgot.png` });
if (process.env.OUTBOX) {
  const outbox = await (await fetch(`${BASE}/api/dev/outbox`)).json();
  const mail = outbox.filter((m) => m.to === 'demo@masjidpulse.local').pop();
  const link = /(http\S+#\/reset\?token=\S+)/.exec(mail.text)[1];
  await pub.goto(link.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: 'networkidle0' });
  await pub.waitForSelector('input[name=password]');
  await pub.bringToFront();
  await pub.screenshot({ path: `${out}/admin-reset.png` });
  console.log('reset page via emailed link ok');
}
// Offline: TV reload with network cut -> must render from cache
console.log('offline step');
await tv.setOfflineMode(true);
await tv
  .reload({ waitUntil: 'domcontentloaded', timeout: 15000 })
  .catch((e) => errors.push('reload offline: ' + e.message));
await new Promise((r) => setTimeout(r, 2500));
const offlineState = await tv.evaluate(() => ({
  displayVisible: !document.getElementById('display').hidden,
  conn: document.getElementById('conn').textContent,
  updated: document.getElementById('updated').textContent,
  rows: document.querySelectorAll('#prayer-rows tr').length,
}));
console.log('offline', JSON.stringify(offlineState));
await tv.bringToFront();
await tv.screenshot({ path: `${out}/tv-offline.png` });
console.log(
  'errors',
  JSON.stringify(
    errors.filter((e) => !/net::ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e)),
    null,
    1,
  ),
);
const realErrors = errors.filter((e) => !/net::ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e));
await browser.close();
const ok = realErrors.length === 0 && offlineState.displayVisible && offlineState.rows >= 5;
console.log(ok ? 'E2E OK' : 'E2E FAILED');
process.exit(ok ? 0 : 1);

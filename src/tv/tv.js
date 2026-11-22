// Masjid Pulse TV display. Renders ONLY the published DisplaySnapshot (cached in localStorage),
// so the screen keeps working offline and after power cycles.
//
// Source file: bundled by scripts/build-tv.mjs into public/tv/app.js, transpiled to ES5 with
// polyfills so old Smart-TV browsers (LG webOS 3.x = Chromium 38, webOS 4.x = Chromium 53,
// Samsung Tizen, Android TV WebViews) can run it. Write modern JS here; never load it directly.
import './polyfills.js';
import * as D from '../shared/tv-entry.ts';

const POLL_MS = 30_000;
const PAIR_POLL_MS = 3_000;
const OFFLINE_AFTER_MS = 2 * 60_000;
const ADHKAR_SLIDE_MS = 12_000;
const KEY = {
  token: 'mp_tv_token',
  snapshot: 'mp_tv_snapshot',
  pairing: 'mp_tv_pairing',
  lastOk: 'mp_tv_last_ok',
  paused: 'mp_tv_paused',
};

const $ = (id) => document.getElementById(id);
const esc = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

const store = {
  get(k) {
    try {
      return JSON.parse(localStorage.getItem(k));
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* storage full or unavailable - keep running from memory */
    }
  },
  del(k) {
    localStorage.removeItem(k);
  },
};

// API base URL. Empty = same origin (served by the Masjid Pulse server). The Android TV app loads
// this page from its bundled assets and passes the configured server as ?api=https://server.
const API = (() => {
  const fromQuery = new URLSearchParams(location.search).get('api');
  if (fromQuery) store.set('mp_tv_api', fromQuery);
  return String(fromQuery || store.get('mp_tv_api') || '').replace(/\/+$/, '');
})();
const apiUrl = (path) => API + path;
const mediaUrl = (url) => (url && url.startsWith('/') ? API + url : url);

let snapshot = store.get(KEY.snapshot);
let token = store.get(KEY.token);
let lastOk = store.get(KEY.lastOk) || 0;
let paused = !!store.get(KEY.paused);
let lastFetchFailed = false;
let rotation = { items: [], index: -1, timer: null, sig: '' };
let adhkarState = { key: '', index: 0, nextAt: 0 };
let prayerAlertActive = false;

function show(id) {
  for (const s of ['welcome', 'pairing', 'waiting', 'display']) $(s).hidden = s !== id;
}

// ---------- Pairing ----------
async function startPairing() {
  show('pairing');
  let pairing = store.get(KEY.pairing);
  while (!token) {
    try {
      if (!pairing || new Date(pairing.expiresAt).getTime() <= Date.now()) {
        const res = await fetch(apiUrl('/api/tv/pairing'), { method: 'POST' });
        if (!res.ok) throw new Error('pairing request failed');
        pairing = await res.json();
        store.set(KEY.pairing, pairing);
      }
      $('pair-code').textContent = pairing.code;
      const mins = Math.max(0, Math.ceil((new Date(pairing.expiresAt).getTime() - Date.now()) / 60000));
      $('pair-info').textContent =
        `Code expires in about ${mins} minute${mins === 1 ? '' : 's'}. A new code appears automatically.`;
      const st = await fetch(apiUrl(`/api/tv/pairing/${pairing.pairingId}`), {
        headers: { 'X-Pairing-Secret': pairing.pairingSecret },
      });
      const body = st.ok ? await st.json() : { status: 'expired' };
      if (body.status === 'paired') {
        token = body.deviceToken;
        store.set(KEY.token, token);
        store.del(KEY.pairing);
        break;
      }
      if (body.status !== 'pending') pairing = null; // expired/consumed/unknown -> get a fresh code
    } catch {
      $('pair-info').textContent = 'No internet connection. Connect this TV to the internet to pair.';
    }
    await new Promise((r) => setTimeout(r, PAIR_POLL_MS));
  }
  await poll();
}

// ---------- Snapshot sync ----------
async function poll() {
  if (!token) return;
  try {
    const v = snapshot ? `?version=${snapshot.version}` : '';
    const res = await fetch(apiUrl(`/api/tv/snapshot${v}`), {
      headers: { Authorization: `Device ${token}` },
      cache: 'no-store',
    });
    if (res.status === 401) {
      // Device removed by an admin: forget credentials and cached display, return to pairing.
      token = null;
      snapshot = null;
      for (const k of Object.values(KEY)) store.del(k);
      startPairing();
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    lastOk = Date.now();
    store.set(KEY.lastOk, lastOk);
    paused = !!body.paused;
    store.set(KEY.paused, paused);
    lastFetchFailed = false;
    if (body.snapshot) {
      snapshot = body.snapshot;
      store.set(KEY.snapshot, snapshot);
    }
  } catch {
    lastFetchFailed = true; // offline: keep rendering from cache
  }
  render();
}

// ---------- Rendering ----------
function render() {
  if (!snapshot) {
    show(token ? 'waiting' : 'pairing');
    return;
  }
  show('display');
  $('mosque-name').textContent =
    snapshot.mosque.name + (snapshot.mosque.city ? ` · ${snapshot.mosque.city}` : '');
  tick();
}

function hijri(date) {
  try {
    const fmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
    // Old engines silently fall back to the Gregorian calendar: show nothing rather than a wrong date.
    if (!/^islamic/.test(fmt.resolvedOptions().calendar || '')) return '';
    return fmt.format(date);
  } catch {
    return '';
  }
}

const ADHAN_BANNER_SEC = 60;
function updateAdhanBanner(days, now) {
  const box = $('adhan-banner');
  if (!box) return;
  let hit = null;
  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    const base = (Date.parse(d.date + 'T00:00:00Z') - Date.parse(now.date + 'T00:00:00Z')) / 1000;
    const prayers = D.displayPrayersForDay(d, snapshot.jummah);
    for (let j = 0; j < prayers.length; j++) {
      const p = prayers[j];
      const s = base + D.adhanAbsMinutes(p) * 60;
      if (now.seconds >= s && now.seconds < s + ADHAN_BANNER_SEC) {
        hit = p;
        break;
      }
    }
    if (hit) break;
  }
  if (!hit) {
    box.hidden = true;
    return null;
  }
  $('adhan-name').textContent = hit.name;
  $('adhan-time').textContent = hit.adhan;
  box.hidden = false;
  return hit;
}

function tick() {
  if (!snapshot) return;
  const tz = snapshot.mosque.timezone;
  const now = D.localNow(tz);
  const nowDate = new Date();
  $('clock').textContent = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false, // hourCycle is ignored before Chromium 73
  })
    .format(nowDate)
    .replace(/^24/, '00');
  const dayDate = new Date(now.date + 'T12:00:00Z');
  const greg = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(dayDate);
  const h = hijri(dayDate);
  $('date').textContent = h ? `${greg} · ${h}` : greg;

  // Yesterday..tomorrow. Days beyond the published window are generated locally from the
  // snapshot's embedded calculation settings, so the TV stays correct even if offline for weeks.
  const days = daysAround(now.date);
  const day = D.findDay(days, now.date);
  const next = D.computeNextEvent(days, snapshot.jummah, now);
  const current = D.currentPrayer(days, snapshot.jummah, now);
  const nextEl = $('next');
  let inPrayer = null;
  for (const d of days) {
    const base = (Date.parse(d.date + 'T00:00:00Z') - Date.parse(now.date + 'T00:00:00Z')) / 1000;
    inPrayer =
      D.displayPrayersForDay(d, snapshot.jummah).find((p) => {
        const iq = D.iqamahAbsMinutes(p);
        if (iq === null) return false;
        const s = base + iq * 60;
        return now.seconds >= s && now.seconds < s + 10 * 60;
      }) || inPrayer;
  }
  if (!day) {
    nextEl.className = 'next';
    nextEl.innerHTML =
      '<span class="stale">Prayer times for today have not been published. Please check with the mosque office.</span>';
  } else if (inPrayer) {
    nextEl.className = 'next inprayer';
    nextEl.textContent = `${inPrayer.name} prayer in progress — please silence your phone`;
  } else if (next) {
    nextEl.className = 'next' + (next.type === 'iqamah' ? ' iqamah' : '');
    const label =
      next.type === 'iqamah'
        ? `${next.prayer.name} Iqamah in`
        : `${next.prayer.name}${next.date !== now.date ? ' (tomorrow)' : ''} in`;
    nextEl.innerHTML = `<span>${esc(label)}</span><span class="count">${D.formatCountdown(next.secondsUntil)}</span>`;
  } else {
    nextEl.className = 'next';
    nextEl.textContent = '';
  }

  const prayers = day ? D.displayPrayersForDay(day, snapshot.jummah) : [];
  $('prayer-rows').innerHTML = prayers
    .map((p) => {
      const cls = [
        p.key === current ? 'current' : '',
        next && next.date === now.date && next.prayer.key === p.key ? 'upcoming' : '',
      ]
        .filter(Boolean)
        .join(' ');
      return `<tr class="${cls}"><td>${esc(p.name)}${p.overridden ? '<span class="badge">today</span>' : ''}</td>
        <td class="t">${esc(p.adhan)}${p.adhanDay ? '<sup>+1</sup>' : ''}</td><td class="t iq">${esc(p.iqamah ?? '—')}${p.iqamahDay ? '<sup>+1</sup>' : ''}</td></tr>`;
    })
    .join('');

  $('jummah').innerHTML = snapshot.jummah.length
    ? `<span><b>Jumu'ah</b></span>` +
      snapshot.jummah
        .map(
          (j) =>
            `<span>${esc(j.label)}: Khutbah ${esc(j.khutbah)} · Iqamah ${esc(j.iqamah)}${j.language ? ` (${esc(j.language)})` : ''}</span>`,
        )
        .join('')
    : '';
  $('jummah').hidden = !snapshot.jummah.length;

  updateRotation(now.date);
  updateAdhkar(days, now);
  const adhan = updateAdhanBanner(days, now);
  prayerAlertActive = Boolean(inPrayer || (next && next.type === 'iqamah') || adhan);
  if (prayerAlertActive) {
    // A flash already on screen must not cover an Athan/Iqamah alert that has just started.
    const waqaf = $('waqaf-flash');
    if (waqaf) waqaf.hidden = true;
  }

  const online = !lastFetchFailed && Date.now() - lastOk < OFFLINE_AFTER_MS;
  const conn = $('conn');
  conn.className = 'conn' + (online ? '' : ' offline');
  conn.textContent = online
    ? paused
      ? '● Online · updates paused'
      : '● Online'
    : '● Offline — showing saved times';
  $('updated').textContent =
    `Last updated ${D.formatAge(snapshot.publishedAt)} · v${snapshot.version}` +
    (lastOk ? ` · last sync ${D.formatAge(new Date(lastOk).toISOString())}` : '');
}

let daysCache = { key: '', days: [] };
function daysAround(date) {
  const key = date + ':' + snapshot.version;
  if (daysCache.key !== key)
    daysCache = { key, days: D.snapshotDaysFor(snapshot, D.datesAround(date, 1, 1)) };
  return daysCache.days;
}

function updateRotation(date) {
  const items = D.buildRotation(snapshot, date);
  const sig = JSON.stringify(items.map((i) => [i.kind, i.item.id])) + snapshot.version;
  if (sig === rotation.sig) return;
  rotation.sig = sig;
  rotation.items = items;
  rotation.index = -1;
  clearTimeout(rotation.timer);
  nextSlide();
}

function nextSlide() {
  const box = $('rotation');
  const items = rotation.items;
  if (!items.length) {
    box.innerHTML = `<div class="empty">${esc(snapshot.mosque.name)}</div>`;
    return;
  }
  rotation.index = (rotation.index + 1) % items.length;
  const it = items[rotation.index];
  if (it.kind === 'announcement') {
    box.innerHTML = `<div class="ann"><h2>${esc(it.item.title)}</h2><p>${esc(it.item.body)}</p></div>`;
  } else if (it.kind === 'donation') {
    const kind =
      it.item.kind === 'fundraising' ? 'Fundraising' : it.item.kind === 'payment' ? 'Payment' : 'Donation';
    box.innerHTML = `<div class="ann don"><h2>${esc(it.item.title)}</h2>
      <p class="pay">${esc(kind)}${it.item.method ? ' · ' + esc(it.item.method) : ''}</p>
      <p class="num">${esc(it.item.account || '')}</p>
      <p>${esc(it.item.note || '')}</p></div>`;
  } else {
    box.innerHTML = `<img src="${esc(mediaUrl(it.item.url))}" alt="" />${it.item.caption ? `<div class="cap">${esc(it.item.caption)}</div>` : ''}`;
  }
  rotation.timer = setTimeout(nextSlide, it.durationSec * 1000);
}

// Seconds after iqamah (or after adhan when iqamah is unset) for a prayer that is in the adhkar window.
function adhkarNow(days, now) {
  for (const d of days) {
    const base = (Date.parse(d.date + 'T00:00:00Z') - Date.parse(now.date + 'T00:00:00Z')) / 1000;
    for (const p of D.displayPrayersForDay(d, snapshot.jummah)) {
      const iq = D.iqamahAbsMinutes(p);
      const origin = iq === null ? D.adhanAbsMinutes(p) * 60 : iq * 60;
      const after = now.seconds - (base + origin);
      const set = D.adhkarWindow(p.key, after);
      if (set) return { set, prayer: p };
    }
  }
  return null;
}

function updateAdhkar(days, now) {
  const box = $('adhkar');
  if (!box) return;
  const win = adhkarNow(days, now);
  if (!win) {
    box.hidden = true;
    adhkarState.key = '';
    return;
  }
  box.hidden = false;
  const sig = win.set.key + ':' + win.prayer.key;
  if (sig !== adhkarState.key) {
    adhkarState = { key: sig, index: 0, nextAt: Date.now() + ADHKAR_SLIDE_MS };
  } else if (Date.now() >= adhkarState.nextAt) {
    adhkarState.index = (adhkarState.index + 1) % win.set.items.length;
    adhkarState.nextAt = Date.now() + ADHKAR_SLIDE_MS;
  }
  const item = win.set.items[adhkarState.index];
  $('adhkar-kicker').textContent = win.set.title + ' · ' + win.prayer.name;
  $('adhkar-so-title').textContent = win.set.titleSo;
  $('adhkar-ar').textContent = item.arabic;
  $('adhkar-so').textContent = item.somali;
  $('adhkar-note').textContent = item.note || '';
  $('adhkar-count').textContent = adhkarState.index + 1 + ' / ' + win.set.items.length;
}

let welcomed = false;
function playWelcome() {
  if (welcomed) return;
  welcomed = true;
  const box = $('welcome');
  if (!box) return;
  box.hidden = false;
  $('welcome-logo').hidden = false;
  $('welcome-credit').hidden = true;
  setTimeout(() => {
    $('welcome-logo').hidden = true;
    $('welcome-credit').hidden = false;
    setTimeout(() => {
      box.hidden = true;
    }, 5000);
  }, 3000);
}

const FLASH_EVERY_MS = 3 * 60 * 1000;
const FLASH_FOR_MS = 5000;
function startWaqafFlash() {
  setInterval(() => {
    const box = $('waqaf-flash');
    const adhkar = $('adhkar');
    if (!box || $('display').hidden) return;
    if ((adhkar && !adhkar.hidden) || prayerAlertActive) return;
    box.hidden = false;
    setTimeout(() => {
      box.hidden = true;
    }, FLASH_FOR_MS);
  }, FLASH_EVERY_MS);
}

// ---------- Boot ----------
setInterval(tick, 1000);
setInterval(poll, POLL_MS);
window.addEventListener('online', poll);
render(); // instant render from cache (works with no network)
startWaqafFlash();
if (token) poll();
else startPairing();
playWelcome();

if ('serviceWorker' in navigator && !API)
  navigator.serviceWorker.register('/tv/sw.js', { scope: '/tv/' }).catch(() => {});

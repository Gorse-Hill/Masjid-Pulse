const KEY = 'mp_phone';
const HARGEISA = { lat: 9.56, lng: 44.065, label: 'Hargeisa' };
const NAMES = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];

const $ = (id) => document.getElementById(id);
const prefs = Object.assign(
  { before: 10, sound: true, lat: null, lng: null, label: '' },
  JSON.parse(localStorage.getItem(KEY) || '{}'),
);
function save() {
  localStorage.setItem(KEY, JSON.stringify(prefs));
}

let data = null;
let alerted = {};

function pad(n) {
  return String(n).padStart(2, '0');
}
function fmtCountdown(sec) {
  const s = Math.max(0, Math.floor(sec));
  return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor((s % 3600) / 60)) + ':' + pad(s % 60);
}
function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}
function beep() {
  if (!prefs.sound) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = 784;
    g.gain.setValueAtTime(0.2, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2);
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 1.2);
  } catch {
    /* sound is optional */
  }
}

async function loadTimes() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Mogadishu';
  const url = `/api/prayer-times?lat=${prefs.lat}&lng=${prefs.lng}&tz=${encodeURIComponent(tz)}&method=MWL`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('times failed');
  data = await res.json();
  render();
}

function render() {
  if (!data) return;
  const prayers = data.prayers.filter((p) => NAMES.includes(p.name));
  const now = nowMinutes();
  let next = prayers.find((p) => p.minutes > now);
  let nextLabel = next ? next.name : 'Fajr (tomorrow)';
  let until = next
    ? (next.minutes - now) * 60
    : data.tomorrowFajr
      ? (1440 - now + data.tomorrowFajr.minutes) * 60
      : 0;
  $('next-label').textContent = nextLabel + ' in';
  $('next-count').textContent = fmtCountdown(until);
  $('prayers').innerHTML = prayers
    .map((p) => {
      const on = Math.abs(p.minutes - now) < 1;
      return `<li class="${on ? 'now' : ''}"><span>${p.name}</span><span class="t">${p.time}</span></li>`;
    })
    .join('');
  checkAlert(prayers, now);
}

function checkAlert(prayers, now) {
  for (const p of prayers) {
    const start = p.minutes - prefs.before;
    if (now >= start && now < p.minutes + 1 && !alerted[p.key]) {
      alerted[p.key] = true;
      $('alert').hidden = false;
      $('alert-text').textContent = now >= p.minutes ? 'Adhan — ' + p.name : p.name + ' in ' + prefs.before + ' min';
      beep();
      if (Notification.permission === 'granted') {
        new Notification('Masjid Pulse', {
          body: now >= p.minutes ? 'Adhan — ' + p.name : p.name + ' in ' + prefs.before + ' minutes',
        });
      }
      setTimeout(() => {
        $('alert').hidden = true;
      }, 60000);
    }
  }
}

async function locate() {
  $('place').textContent = 'Finding your location…';
  const pos = await new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(p),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 8000 },
    );
  });
  if (pos) {
    prefs.lat = pos.coords.latitude;
    prefs.lng = pos.coords.longitude;
    prefs.label = 'Your location';
  } else if (prefs.lat == null) {
    prefs.lat = HARGEISA.lat;
    prefs.lng = HARGEISA.lng;
    prefs.label = HARGEISA.label;
  }
  save();
  $('place').textContent = prefs.label + ' · Muslim World League';
  await loadTimes();
}

$('before').value = prefs.before;
$('sound').checked = prefs.sound;
$('before').addEventListener('change', () => {
  prefs.before = Math.max(0, Math.min(60, Number($('before').value) || 0));
  save();
});
$('sound').addEventListener('change', () => {
  prefs.sound = $('sound').checked;
  save();
});
$('enable').addEventListener('click', async () => {
  if (!('Notification' in window)) {
    $('status').textContent = 'This phone cannot show notifications from a page. Keep the page open for the sound.';
    return;
  }
  const perm = await Notification.requestPermission();
  $('status').textContent =
    perm === 'granted'
      ? 'Alerts are on. Add this page to your Home Screen so it stays available.'
      : 'Alerts were not allowed. Keep the page open for the sound.';
});
if ('Notification' in window && Notification.permission === 'granted') {
  $('status').textContent = 'Alerts are on.';
}

locate().catch(() => {
  $('place').textContent = 'Could not load times. Check the connection and reload.';
});
setInterval(render, 1000);

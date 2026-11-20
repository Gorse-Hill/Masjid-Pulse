// Masjid Pulse Admin - dependency-free SPA (hash router). Doubles as the mobile PWA.
const PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
const NAMES = { fajr: 'Fajr', dhuhr: 'Dhuhr', asr: 'Asr', maghrib: 'Maghrib', isha: 'Isha' };
const RANK = { editor: 1, admin: 2, owner: 3 };
const MAX_SLIDE_BYTES = 2 * 1024 * 1024;

const state = {
  token: localStorage.getItem('mp_token'),
  mosques: [],
  mosqueId: Number(localStorage.getItem('mp_mosque')) || null,
  user: null,
};

const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');
const esc = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const role = () => state.mosques.find((m) => m.id === state.mosqueId)?.role ?? 'editor';
const atLeast = (r) => RANK[role()] >= RANK[r];
const mpath = (p = '') => `/api/mosques/${state.mosqueId}${p}`;

function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.className = ''), 3500);
}

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  let body = opts.body;
  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const res = await fetch(path, { method: opts.method || 'GET', headers, body });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token && !path.startsWith('/api/auth')) {
    logout();
    throw new Error('Session expired, please log in again');
  }
  if (!res.ok) {
    const details = Array.isArray(data.details)
      ? ': ' + data.details.map((d) => (typeof d === 'string' ? d : d.message)).join('; ')
      : '';
    throw new Error((data.error || `Request failed (${res.status})`) + details);
  }
  return data;
}

/** Wrap an async handler: show errors as toasts. */
const guard =
  (fn) =>
  async (...args) => {
    try {
      await fn(...args);
    } catch (e) {
      toast(e.message, true);
    }
  };

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function logout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('mp_token');
  location.hash = '#/login';
}

async function loadMe() {
  const me = await api('/api/me');
  state.user = me.user;
  state.mosques = me.mosques;
  if (!state.mosques.find((m) => m.id === state.mosqueId)) state.mosqueId = state.mosques[0]?.id ?? null;
  localStorage.setItem('mp_mosque', String(state.mosqueId ?? ''));
  const sw = $('#mosque-switch');
  sw.innerHTML = state.mosques.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
  sw.value = String(state.mosqueId);
  sw.hidden = state.mosques.length < 2;
}

function addMinutes(hhmm, delta) {
  const [h, m] = hhmm.split(':').map(Number);
  const t = (((h * 60 + m + delta) % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

function fmtCountdown(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString() : '—');

// ---------------- Screens ----------------

function renderLogin() {
  view.innerHTML = `
  <div class="auth card">
    <img class="auth-logo" src="/brand/logo.png" alt="Masjid Pulse" />
    <h2 style="text-align:center">Log in</h2>
    <form id="f">
      <label>Email</label><input name="email" type="email" required autocomplete="username" />
      <label style="margin-top:10px">Password</label><input name="password" type="password" required autocomplete="current-password" />
      <p><button class="big">Log in</button></p>
    </form>
    <p class="muted"><a href="#/forgot">Forgot password?</a> · New mosque? <a href="#/register">Register here</a></p>
  </div>`;
  $('#f').onsubmit = guard(async (e) => {
    e.preventDefault();
    const out = await api('/api/auth/login', { method: 'POST', body: formData(e.target) });
    state.token = out.token;
    localStorage.setItem('mp_token', out.token);
    location.hash = '#/today';
  });
}

function renderRegister() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  view.innerHTML = `
  <div class="auth card">
    <img class="auth-logo" src="/brand/logo.png" alt="Masjid Pulse" />
    <h2 style="text-align:center">Register your mosque</h2>
    <form id="f">
      <label>Mosque name</label><input name="mosqueName" required />
      <div class="row" style="margin-top:10px">
        <div><label>City</label><input name="city" /></div>
        <div><label>Timezone</label><input name="timezone" value="${esc(tz)}" required /></div>
      </div>
      <label style="margin-top:10px">Your name</label><input name="name" required />
      <label style="margin-top:10px">Email</label><input name="email" type="email" required />
      <label style="margin-top:10px">Password (min 8 characters)</label><input name="password" type="password" minlength="8" required />
      <p><button class="big">Create account</button></p>
    </form>
    <p class="muted">Already registered? <a href="#/login">Log in</a></p>
  </div>`;
  $('#f').onsubmit = guard(async (e) => {
    e.preventDefault();
    const out = await api('/api/auth/register', { method: 'POST', body: formData(e.target) });
    state.token = out.token;
    state.mosqueId = out.mosque.id;
    localStorage.setItem('mp_token', out.token);
    localStorage.setItem('mp_mosque', String(out.mosque.id));
    toast(
      out.emailVerified
        ? 'Mosque registered. Next, set up prayer times.'
        : out.emailSent === false
          ? 'Mosque registered, but the confirmation email could not be sent. Use "Resend" on the Today screen.'
          : 'Mosque registered. Check your inbox to confirm your email, then set up prayer times.',
    );
    location.hash = '#/prayers';
  });
}

function authCard(title, inner) {
  return `<div class="auth card"><img class="auth-logo" src="/brand/logo.png" alt="Masjid Pulse" /><h2 style="text-align:center">${title}</h2>${inner}</div>`;
}

function renderForgot() {
  view.innerHTML = authCard(
    'Forgot password',
    `<form id="f"><label>Email</label><input name="email" type="email" required autocomplete="username" />
      <p><button class="big">Email me a reset link</button></p></form>
      <p class="muted"><a href="#/login">Back to log in</a></p>`,
  );
  $('#f').onsubmit = guard(async (e) => {
    e.preventDefault();
    await api('/api/auth/forgot-password', { method: 'POST', body: formData(e.target) });
    view.innerHTML = authCard(
      'Check your email',
      '<p>If an account exists for that address, we sent a link to reset the password. It expires in 1 hour.</p><p><a href="#/login">Back to log in</a></p>',
    );
  });
}

function renderReset(params) {
  view.innerHTML = authCard(
    'Choose a new password',
    `<form id="f"><label>New password (min 8 characters)</label><input name="password" type="password" minlength="8" required autocomplete="new-password" />
      <p><button class="big">Save new password</button></p></form>`,
  );
  $('#f').onsubmit = guard(async (e) => {
    e.preventDefault();
    await api('/api/auth/reset-password', {
      method: 'POST',
      body: { token: params.get('token'), password: formData(e.target).password },
    });
    state.token = null;
    localStorage.removeItem('mp_token');
    toast('Password changed. Please log in.');
    location.hash = '#/login';
  });
}

async function renderVerify(params) {
  view.innerHTML = authCard('Confirming your email…', '<p class="muted">One moment…</p>');
  try {
    const out = await api('/api/auth/verify-email', { method: 'POST', body: { token: params.get('token') } });
    state.user = null;
    view.innerHTML = authCard(
      'Email confirmed',
      `<p>Thank you — ${esc(out.email)} is confirmed. You can now publish to your TVs.</p><p><a href="#/${state.token ? 'today' : 'login'}">Continue</a></p>`,
    );
  } catch (e) {
    view.innerHTML = authCard(
      'Link not valid',
      `<div class="status bad">${esc(e.message)}</div><p><a href="#/today">Continue</a></p>`,
    );
  }
}

async function renderAcceptInvite(params) {
  const token = params.get('token');
  let inv;
  try {
    inv = await api(`/api/auth/invite?token=${encodeURIComponent(token || '')}`);
  } catch (e) {
    view.innerHTML = authCard('Invitation not valid', `<div class="status bad">${esc(e.message)}</div>`);
    return;
  }
  view.innerHTML = authCard(
    `Join ${esc(inv.mosque)}`,
    `<p>You were invited as <b>${esc(inv.role)}</b> (${esc(inv.email)}).</p>
    <form id="f">${
      inv.hasAccount
        ? '<p class="muted">You already have an account; accepting adds this mosque to it.</p>'
        : `<label>Your name</label><input name="name" value="${esc(inv.name ?? '')}" required />
           <label style="margin-top:10px">Choose a password (min 8 characters)</label><input name="password" type="password" minlength="8" required autocomplete="new-password" />`
    }<p><button class="big">Accept invitation</button></p></form>`,
  );
  $('#f').onsubmit = guard(async (e) => {
    e.preventDefault();
    const out = await api('/api/auth/accept-invite', {
      method: 'POST',
      body: { token, ...formData(e.target) },
    });
    state.token = out.token;
    state.user = null;
    state.mosqueId = out.mosque.id;
    localStorage.setItem('mp_token', out.token);
    localStorage.setItem('mp_mosque', String(out.mosque.id));
    toast('Welcome!');
    location.hash = '#/today';
  });
}

function verifyBanner() {
  if (state.user?.emailVerified !== false) return '';
  return `<div class="status warn">✉ Please confirm your email (${esc(state.user.email)}) — publishing and pairing TVs are locked until you do.
    <button class="secondary" id="resend" style="margin-left:8px">Resend email</button></div>`;
}

function wireVerifyBanner() {
  const b = $('#resend');
  if (b)
    b.onclick = guard(async () => {
      const out = await api('/api/auth/resend-verification', { method: 'POST' });
      toast(
        out.alreadyVerified
          ? 'Already confirmed'
          : out.emailSent
            ? 'Email sent — check your inbox'
            : 'Could not send the email',
        !out.emailSent && !out.alreadyVerified,
      );
    });
}

function statusBanner(s) {
  if (s.paused)
    return `<div class="status bad">⏸ Display updates are PAUSED. TVs keep showing version ${s.lastPublished?.version ?? '—'}.</div>`;
  if (!s.lastPublished)
    return `<div class="status warn">Nothing published yet. TVs have nothing to show until you publish.</div>`;
  if (s.hasUnpublishedChanges)
    return `<div class="status warn">⚠ You have unpublished changes. TVs show version ${s.lastPublished.version} (${esc(fmtTime(s.lastPublished.publishedAt))}).</div>`;
  return `<div class="status ok">✓ Published. TVs show the latest version ${s.lastPublished.version} (${esc(fmtTime(s.lastPublished.publishedAt))}).</div>`;
}

async function renderToday() {
  const t = await api(mpath('/today'));
  const ne = t.nextEvent;
  const prayers = t.today?.prayers ?? [];
  view.innerHTML = `
    <h1>${esc(t.mosque.name)} · Today <span class="muted">${esc(t.date)}</span></h1>
    ${verifyBanner()}
    ${statusBanner(t.status)}
    <div class="card">
      <button id="publish" class="big" ${t.status.paused ? 'disabled' : ''}>Publish to TVs</button>
      <p class="muted">Changes only appear on TVs after you publish. TVs check for updates about every 30 seconds.</p>
    </div>
    ${ne ? `<div class="card next">Next: ${esc(ne.prayer.name)} ${ne.type === 'iqamah' ? 'iqamah' : 'adhan'} at ${esc(ne.at)} · in ${fmtCountdown(ne.secondsUntil)}</div>` : ''}
    <div class="card">
      <h2>Quick iqamah update</h2>
      ${
        prayers.length === 0
          ? '<p>No prayer times yet. <a href="#/prayers">Enter prayer times</a>.</p>'
          : `
      <label style="display:flex;gap:8px;align-items:center;font-weight:400"><input type="checkbox" id="todayOnly" style="width:auto" checked /> Today only (does not change future days)</label>
      <table><thead><tr><th>Prayer</th><th>Adhan</th><th>Iqamah</th></tr></thead><tbody>
      ${prayers
        .map(
          (p) => `
        <tr><td><b>${esc(p.name)}</b> ${p.overridden ? '<span class="pill scheduled">today only</span>' : ''}</td><td>${esc(p.adhan)}${dayMark(p.adhanDay)}</td>
        <td><div class="iq" data-prayer="${p.key}">
          <button class="secondary" data-delta="-5">−5</button>
          <input type="text" inputmode="numeric" pattern="([01][0-9]|2[0-3]):[0-5][0-9]" placeholder="HH:MM" maxlength="5" value="${esc(p.iqamah ?? '')}" />
          <button class="secondary" data-delta="5">+5</button>
          <button data-save>Save</button>
        </div></td></tr>`,
        )
        .join('')}
      </tbody></table>`
      }
    </div>
    <div class="card">
      <h2>TV status</h2>
      ${
        t.devices.length === 0
          ? `<p>No TVs paired yet. ${atLeast('admin') ? '<a href="#/devices">Pair a TV</a>' : ''}</p>`
          : `
      <table><tbody>${t.devices
        .map(
          (d) => `
        <tr><td>${esc(d.name)}</td><td><span class="pill ${d.online ? 'online' : 'offline'}">${d.online ? 'online' : 'offline'}</span></td>
        <td class="muted">${d.upToDate ? 'up to date' : `showing v${d.snapshotVersion ?? '—'}`}</td><td class="muted hide-sm">seen ${esc(fmtTime(d.lastSeenAt))}</td></tr>`,
        )
        .join('')}
      </tbody></table>`
      }
    </div>
    ${
      atLeast('admin')
        ? `<div class="card"><h2>Emergency pause</h2>
      <p class="muted">Pausing stops all updates; TVs keep showing the last approved version.</p>
      <button id="pause" class="${t.status.paused ? '' : 'danger'}">${t.status.paused ? 'Resume updates' : 'Pause display updates'}</button></div>`
        : ''
    }
  `;
  wireVerifyBanner();
  $('#publish').onclick = guard(async () => {
    const out = await api(mpath('/publish'), { method: 'POST' });
    toast(`Published version ${out.version}`);
    renderToday();
  });
  view.querySelectorAll('.iq').forEach((row) => {
    const input = $('input', row);
    row.querySelectorAll('[data-delta]').forEach((b) => {
      b.onclick = () => {
        if (input.value) input.value = addMinutes(input.value, Number(b.dataset.delta));
      };
    });
    $('[data-save]', row).onclick = guard(async () => {
      await api(mpath(`/prayers/${t.date}/iqamah`), {
        method: 'PATCH',
        body: { prayer: row.dataset.prayer, iqamah: input.value, todayOnly: $('#todayOnly').checked },
      });
      toast(`${NAMES[row.dataset.prayer]} iqamah saved — remember to Publish`);
      renderToday();
    });
  });
  const pause = $('#pause');
  if (pause)
    pause.onclick = guard(async () => {
      if (!t.status.paused && !confirm('Pause all display updates?')) return;
      await api(mpath('/pause'), { method: 'POST', body: { paused: !t.status.paused } });
      renderToday();
    });
}

const TIME_PATTERN = '([01][0-9]|2[0-3]):[0-5][0-9]';
const timeInput = (name, value, extra = '') =>
  `<input type="text" inputmode="numeric" pattern="${TIME_PATTERN}" placeholder="HH:MM" maxlength="5" name="${name}" value="${esc(value ?? '')}" ${extra} />`;
const dayMark = (n) =>
  n > 0
    ? ' <span class="pill scheduled" title="after midnight">+1 day</span>'
    : n < 0
      ? ' <span class="pill scheduled">−1 day</span>'
      : '';

function fourteenDayTable(list) {
  return `<div class="card"><h2>Next 14 days</h2>
      <div class="scroll-x"><table><thead><tr><th>Date</th>${PRAYERS.map((k) => `<th>${NAMES[k]}</th>`).join('')}</tr></thead><tbody>
      ${list.days
        .map(
          (
            d,
          ) => `<tr><td><a href="#/prayers?date=${d.date}">${esc(d.date)}</a>${list.mode === 'manual' && !d.explicit ? ' <span class="muted">↳</span>' : ''}</td>
        ${PRAYERS.map((k) => {
          const p = d.effective?.prayers.find((x) => x.key === k);
          return `<td>${p ? `${esc(p.adhan)}${dayMark(p.adhanDay)}${p.overridden ? ' ✎' : ''}<br><span class="muted">${esc(p.iqamah ?? '')}</span>` : '—'}</td>`;
        }).join('')}</tr>`,
        )
        .join('')}
      </tbody></table></div>
    </div>`;
}

function rulesRows(rules) {
  return PRAYERS.map((k) => {
    const r = rules[k];
    return `<tr data-rule="${k}"><td><b>${NAMES[k]}</b></td>
      <td><select name="mode"><option value="offset" ${r.mode === 'offset' ? 'selected' : ''}>Minutes after adhan</option>
        <option value="fixed" ${r.mode === 'fixed' ? 'selected' : ''}>Fixed time</option>
        <option value="none" ${r.mode === 'none' ? 'selected' : ''}>No iqamah</option></select></td>
      <td><input name="offsetMinutes" type="number" min="0" max="180" value="${esc(r.offsetMinutes ?? 10)}" style="width:5em" /></td>
      <td>${timeInput('fixedTime', r.fixedTime ?? '')}</td>
      <td><select name="roundTo">${[0, 5, 10, 15, 30].map((n) => `<option value="${n}" ${Number(r.roundTo ?? 0) === n ? 'selected' : ''}>${n ? `${n} min` : 'none'}</option>`).join('')}</select>
        <select name="roundMode"><option value="up" ${r.roundMode === 'up' ? 'selected' : ''}>up</option><option value="nearest" ${r.roundMode !== 'up' ? 'selected' : ''}>nearest</option></select></td></tr>`;
  }).join('');
}

function readRules() {
  const out = {};
  view.querySelectorAll('[data-rule]').forEach((row) => {
    const g = (n) => $(`[name=${n}]`, row).value;
    const mode = g('mode');
    out[row.dataset.rule] = {
      mode,
      ...(mode === 'offset' ? { offsetMinutes: Number(g('offsetMinutes')) } : {}),
      ...(mode === 'fixed' ? { fixedTime: g('fixedTime') } : {}),
      roundTo: Number(g('roundTo')),
      roundMode: g('roundMode'),
    };
  });
  return out;
}

function readCalc() {
  const f = $('#calc');
  const v = formData(f);
  return {
    latitude: Number(v.latitude),
    longitude: Number(v.longitude),
    timezone: v.timezone,
    method: v.method,
    madhab: v.madhab,
    highLatitudeRule: v.highLatitudeRule,
  };
}

async function renderPrayers(params) {
  const [list, settings] = await Promise.all([
    api(mpath('/prayers?days=14')),
    api(mpath('/prayer-settings')),
  ]);
  const date = params.get('date') || list.today;
  const sel = (await api(mpath(`/prayers?from=${date}&days=1`))).days[0];
  const eff = sel.effective;
  const val = (k, f) => eff?.prayers.find((p) => p.key === k)?.[f] ?? '';
  const calculated = settings.source === 'calculated';
  const canAdmin = atLeast('admin');
  view.innerHTML = `
    <h1>Prayer times</h1>
    <div class="card">
      <h2>Location &amp; calculation</h2>
      <p class="muted">${calculated ? 'Adhan times are <b>calculated automatically</b> every day from your location — no daily edits needed.' : 'You are entering times <b>manually</b>. Switch to automatic times by setting your location.'}</p>
      <form id="calc">
        <div class="row">
          <div><label>Find city (optional)</label><div class="inline"><input id="city-q" placeholder="e.g. Fort McMurray" /><button type="button" class="secondary" id="city-go">Search</button></div>
            <div id="city-results" class="muted"></div></div>
        </div>
        <div class="row" style="margin-top:10px">
          <div><label>Latitude</label><input name="latitude" type="number" step="any" min="-90" max="90" value="${esc(settings.latitude ?? '')}" required /></div>
          <div><label>Longitude</label><input name="longitude" type="number" step="any" min="-180" max="180" value="${esc(settings.longitude ?? '')}" required /></div>
          <div><label>Timezone (IANA)</label><input name="timezone" value="${esc(settings.timezone)}" required /></div>
        </div>
        <p><button type="button" class="secondary" id="geo">📍 Use my location</button></p>
        <div class="row">
          <div><label>Calculation method</label><select name="method">${settings.methods.map((m) => `<option value="${m.key}" ${m.key === settings.method ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select></div>
          <div><label>Asr</label><select name="madhab"><option value="shafi" ${settings.madhab === 'shafi' ? 'selected' : ''}>Shafi'i / Maliki / Hanbali (standard)</option><option value="hanafi" ${settings.madhab === 'hanafi' ? 'selected' : ''}>Hanafi (later Asr)</option></select></div>
          <div><label>High-latitude rule</label><select name="highLatitudeRule">${settings.highLatitudeRules
            .map(
              (r) =>
                `<option value="${r}" ${r === settings.highLatitudeRule ? 'selected' : ''}>${{ auto: 'Automatic (recommended)', middleofthenight: 'Middle of the night', seventhofthenight: 'One seventh of the night', twilightangle: 'Twilight angle' }[r]}</option>`,
            )
            .join('')}</select></div>
        </div>
        <h2 style="margin-top:16px">Iqamah rules</h2>
        <div class="scroll-x"><table><thead><tr><th>Prayer</th><th>Rule</th><th>Minutes</th><th>Fixed time</th><th>Round</th></tr></thead>
        <tbody>${rulesRows(settings.rules)}</tbody></table></div>
        <p class="muted">A fixed iqamah that falls before the adhan (e.g. summer Isha) automatically becomes adhan + 10 minutes, rounded up.</p>
        <h2>Preview (not saved)</h2>
        <div id="preview" class="muted">Enter a location to preview today's times.</div>
        <p>
          ${canAdmin ? `<button class="big" id="save-calc">Use automatic times with these settings</button>` : ''}
          <button type="button" class="${canAdmin ? 'secondary' : 'big'}" id="save-rules">Save iqamah rules only</button>
          ${canAdmin && calculated ? `<button type="button" class="secondary" id="to-manual">Switch to manual times</button>` : ''}
        </p>
        ${canAdmin ? '' : '<p class="muted">Only admins can change the location or method.</p>'}
      </form>
    </div>
    ${
      calculated
        ? `<div class="card"><h2>Override for one day</h2>
      <form id="ov"><div class="row">
        <div><label>Date</label><input type="date" name="date" id="date" value="${esc(date)}" required /></div>
        <div><label>Prayer</label><select name="prayer">${PRAYERS.map((k) => `<option value="${k}">${NAMES[k]}</option>`).join('')}</select></div>
        <div><label>Adhan (optional)</label>${timeInput('adhan', '')}</div>
        <div><label>Iqamah (optional)</label>${timeInput('iqamah', '')}</div>
      </div><p><button>Save override</button></p></form>
      ${sel.overrides.length ? `<p>${esc(date)} has ${sel.overrides.length} override(s). <button class="secondary" id="clear">Clear overrides</button></p>` : ''}
      </div>`
        : `<div class="card">
      <h2>Manual times</h2>
      <form id="f">
        <div class="row"><div><label>Date</label><input type="date" name="date" id="date" value="${esc(date)}" required /></div></div>
        <p class="muted">${sel.explicit ? 'Times saved for this date.' : sel.sourceDate ? `Showing times carried forward from ${esc(sel.sourceDate)}. Saving creates times from this date onward.` : 'No times yet — enter them below.'}</p>
        <table><thead><tr><th>Prayer</th><th>Adhan</th><th>Iqamah</th></tr></thead><tbody>
        ${PRAYERS.map(
          (k) => `<tr><td><b>${NAMES[k]}</b></td>
          <td>${timeInput(`${k}_adhan`, val(k, 'adhan'), 'required')}</td>
          <td>${timeInput(`${k}_iqamah`, val(k, 'iqamah'))}</td></tr>`,
        ).join('')}
        </tbody></table>
        <p class="muted">All times are 24-hour HH:MM (e.g. 13:05). Times apply to this date and every later date until you change them again. For a one-off change use "Today only" on the Today screen.</p>
        <p><button class="big">Save prayer times</button></p>
      </form>
      ${sel.overrides.length ? `<p>This date has ${sel.overrides.length} "today only" override(s). <button class="secondary" id="clear">Clear overrides</button></p>` : ''}
    </div>`
    }
    ${fourteenDayTable(list)}`;

  // ---- live preview ----
  const preview = guard(async () => {
    const calc = readCalc();
    if (!Number.isFinite(calc.latitude) || !Number.isFinite(calc.longitude) || !$('[name=latitude]').value)
      return;
    const out = await api(mpath('/prayer-settings/preview'), {
      method: 'POST',
      body: { calc, rules: readRules(), days: 1 },
    });
    const d = out.days[0];
    $('#preview').innerHTML =
      `<table><thead><tr><th>${esc(d.date)}</th><th>Adhan</th><th>Iqamah</th></tr></thead><tbody>
      ${d.prayers.map((p) => `<tr><td><b>${esc(p.name)}</b></td><td>${esc(p.adhan)}${dayMark(p.adhanDay)}</td><td>${esc(p.iqamah ?? '—')}${dayMark(p.iqamahDay)}</td></tr>`).join('')}
      <tr><td class="muted">Sunrise</td><td class="muted">${esc(d.sunrise)}</td><td></td></tr></tbody></table>`;
  });
  let timer;
  $('#calc').addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(preview, 400);
  });
  $('#calc').addEventListener('change', () => {
    clearTimeout(timer);
    timer = setTimeout(preview, 100);
  });
  preview();

  $('#geo').onclick = () => {
    if (!navigator.geolocation) return toast('Location is not available in this browser', true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        $('[name=latitude]').value = pos.coords.latitude.toFixed(4);
        $('[name=longitude]').value = pos.coords.longitude.toFixed(4);
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (tz) $('[name=timezone]').value = tz;
        preview();
      },
      (err) => toast(`Could not get location: ${err.message}`, true),
      { timeout: 15000 },
    );
  };
  // Optional city search via OpenStreetMap Nominatim (called from the browser, only on click).
  $('#city-go').onclick = guard(async () => {
    const q = $('#city-q').value.trim();
    if (!q) return;
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`,
      { headers: { Accept: 'application/json' } },
    );
    const items = await res.json();
    const box = $('#city-results');
    box.innerHTML = items.length
      ? items.map((it, i) => `<div><a href="#" data-i="${i}">${esc(it.display_name)}</a></div>`).join('') +
        '<div style="font-size:12px">Search © OpenStreetMap contributors. Check the timezone after choosing.</div>'
      : 'No results';
    box.querySelectorAll('[data-i]').forEach((a) => {
      a.onclick = (e) => {
        e.preventDefault();
        const it = items[Number(a.dataset.i)];
        $('[name=latitude]').value = Number(it.lat).toFixed(4);
        $('[name=longitude]').value = Number(it.lon).toFixed(4);
        box.innerHTML = '';
        preview();
      };
    });
  });

  $('#calc').onsubmit = guard(async (e) => {
    e.preventDefault();
    await api(mpath('/prayer-settings'), { method: 'PUT', body: { source: 'calculated', ...readCalc() } });
    await api(mpath('/iqamah-rules'), { method: 'PUT', body: readRules() });
    toast('Automatic prayer times saved — remember to Publish');
    renderPrayers(params);
  });
  $('#save-rules').onclick = guard(async () => {
    await api(mpath('/iqamah-rules'), { method: 'PUT', body: readRules() });
    toast('Iqamah rules saved — remember to Publish');
    renderPrayers(params);
  });
  const toManual = $('#to-manual');
  if (toManual)
    toManual.onclick = guard(async () => {
      if (!confirm('Switch to manually entered prayer times?')) return;
      await api(mpath('/prayer-settings'), { method: 'PUT', body: { source: 'manual' } });
      renderPrayers(params);
    });

  $('#date').onchange = (e) => (location.hash = `#/prayers?date=${e.target.value}`);
  const ov = $('#ov');
  if (ov)
    ov.onsubmit = guard(async (e) => {
      e.preventDefault();
      const v = formData(e.target);
      await api(mpath(`/prayers/${v.date}/override`), {
        method: 'PUT',
        body: { prayer: v.prayer, adhan: v.adhan || null, iqamah: v.iqamah || null },
      });
      toast('Override saved — remember to Publish');
      renderPrayers(new URLSearchParams(`date=${v.date}`));
    });
  const f = $('#f');
  if (f)
    f.onsubmit = guard(async (e) => {
      e.preventDefault();
      const v = formData(e.target);
      const body = Object.fromEntries(
        PRAYERS.map((k) => [k, { adhan: v[`${k}_adhan`], iqamah: v[`${k}_iqamah`] || null }]),
      );
      await api(mpath(`/prayers/${v.date}`), { method: 'PUT', body });
      toast('Prayer times saved — remember to Publish');
      renderPrayers(new URLSearchParams(`date=${v.date}`));
    });
  const clear = $('#clear');
  if (clear)
    clear.onclick = guard(async () => {
      await api(mpath(`/prayers/${date}/overrides`), { method: 'DELETE' });
      renderPrayers(params);
    });
}

async function renderJummah() {
  const rows = await api(mpath('/jummah'));
  view.innerHTML = `
    <h1>Jummah</h1>
    <div class="card"><table><thead><tr><th>Label</th><th>Khutbah</th><th>Iqamah</th><th class="hide-sm">Language</th><th></th></tr></thead><tbody>
      ${
        rows
          .map(
            (
              j,
            ) => `<tr><td>${esc(j.label)}</td><td>${esc(j.khutbah)}</td><td>${esc(j.iqamah)}</td><td class="hide-sm">${esc(j.language ?? '')}</td>
        <td><button class="danger" data-del="${j.id}">Delete</button></td></tr>`,
          )
          .join('') || '<tr><td colspan="5">No Jummah times yet.</td></tr>'
      }
    </tbody></table></div>
    <div class="card"><h2>Add Jummah</h2><form id="f" class="row">
      <div><label>Label</label><input name="label" value="${rows.length ? `${rows.length + 1}${['st', 'nd', 'rd'][rows.length] ?? 'th'} Jumu'ah` : "Jumu'ah"}" required /></div>
      <div><label>Khutbah</label><input type="text" inputmode="numeric" pattern="([01][0-9]|2[0-3]):[0-5][0-9]" placeholder="HH:MM" maxlength="5" name="khutbah" required /></div>
      <div><label>Iqamah</label><input type="text" inputmode="numeric" pattern="([01][0-9]|2[0-3]):[0-5][0-9]" placeholder="HH:MM" maxlength="5" name="iqamah" required /></div>
      <div><label>Language</label><input name="language" /></div>
      <div><button>Add</button></div>
    </form></div>`;
  $('#f').onsubmit = guard(async (e) => {
    e.preventDefault();
    const v = formData(e.target);
    await api(mpath('/jummah'), {
      method: 'POST',
      body: { ...v, language: v.language || null, sortOrder: rows.length },
    });
    toast('Jummah added — remember to Publish');
    renderJummah();
  });
  view.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = guard(async () => {
      await api(mpath(`/jummah/${b.dataset.del}`), { method: 'DELETE' });
      renderJummah();
    });
  });
}

async function renderDonations() {
  const rows = await api(mpath('/donations'));
  view.innerHTML = `
    <h1>Donations & payments</h1>
    <p class="muted">These appear on the TV: fundraising notices and the mosque payment numbers.</p>
    <div class="card"><h2>Add</h2><form id="f">
      <label>Title</label><input name="title" maxlength="120" required placeholder="Friday collection / Masjid fund" />
      <div class="row" style="margin-top:10px">
        <div><label>Type</label><select name="kind">
          <option value="donation">Donation collection</option>
          <option value="fundraising">Fundraising</option>
          <option value="payment">Payment number</option>
        </select></div>
        <div><label>Method</label><input name="method" maxlength="40" placeholder="Zaad, EVC Plus, eDahab, Bank" /></div>
      </div>
      <label style="margin-top:10px">Number / account</label><input name="account" maxlength="80" placeholder="e.g. 25263…" />
      <label style="margin-top:10px">Note</label><textarea name="note" maxlength="400" placeholder="Optional extra text"></textarea>
      <p><button>Add</button></p>
    </form></div>
    <div class="card"><table><thead><tr><th>On the TV</th><th>Number</th><th></th></tr></thead><tbody>
      ${
        rows
          .map(
            (
              d,
            ) => `<tr><td><b>${esc(d.title)}</b><br><span class="muted">${esc(d.kind)}${d.method ? ' · ' + esc(d.method) : ''}</span></td>
        <td><b>${esc(d.account || '—')}</b><br><span class="muted">${esc(d.note || '')}</span></td>
        <td><button class="danger" data-del="${d.id}">Delete</button></td></tr>`,
          )
          .join('') || '<tr><td colspan="3">No donations or payment numbers yet.</td></tr>'
      }
    </tbody></table></div>`;
  $('#f').onsubmit = guard(async (e) => {
    e.preventDefault();
    await api(mpath('/donations'), { method: 'POST', body: formData(e.target) });
    toast('Saved — remember to Publish');
    renderDonations();
  });
  view.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = guard(async () => {
      if (!confirm('Remove this from the TV?')) return;
      await api(mpath(`/donations/${b.dataset.del}`), { method: 'DELETE' });
      renderDonations();
    });
  });
}

async function renderAnnouncements(params) {
  const rows = await api(mpath('/announcements'));
  const editing = rows.find((a) => String(a.id) === params.get('edit'));
  const today = new Date().toISOString().slice(0, 10);
  view.innerHTML = `
    <h1>Announcements</h1>
    <div class="card"><h2>${editing ? 'Edit announcement' : 'New announcement'}</h2><form id="f">
      <label>Title</label><input name="title" maxlength="120" required value="${esc(editing?.title)}" />
      <label style="margin-top:10px">Text</label><textarea name="body" maxlength="1000">${esc(editing?.body)}</textarea>
      <div class="row" style="margin-top:10px">
        <div><label>Show from</label><input type="date" name="startDate" required value="${esc(editing?.startDate ?? today)}" /></div>
        <div><label>Until (auto-expires after)</label><input type="date" name="endDate" required value="${esc(editing?.endDate ?? today)}" /></div>
        <div><button>${editing ? 'Save' : 'Add'}</button> ${editing ? '<a href="#/announcements">Cancel</a>' : ''}</div>
      </div>
    </form></div>
    <div class="card"><table><thead><tr><th>Title</th><th>Dates</th><th>Status</th><th></th></tr></thead><tbody>
      ${
        rows
          .map(
            (a) => `<tr><td><b>${esc(a.title)}</b><br><span class="muted">${esc(a.body)}</span></td>
        <td>${esc(a.startDate)} → ${esc(a.endDate)}</td><td><span class="pill ${a.status}">${a.status}</span></td>
        <td><a href="#/announcements?edit=${a.id}">Edit</a> <button class="danger" data-del="${a.id}">Delete</button></td></tr>`,
          )
          .join('') || '<tr><td colspan="4">No announcements.</td></tr>'
      }
    </tbody></table></div>`;
  $('#f').onsubmit = guard(async (e) => {
    e.preventDefault();
    const body = formData(e.target);
    if (editing) await api(mpath(`/announcements/${editing.id}`), { method: 'PUT', body });
    else await api(mpath('/announcements'), { method: 'POST', body });
    toast('Saved — remember to Publish');
    location.hash = '#/announcements';
    if (!editing) renderAnnouncements(new URLSearchParams());
  });
  view.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = guard(async () => {
      if (!confirm('Delete this announcement?')) return;
      await api(mpath(`/announcements/${b.dataset.del}`), { method: 'DELETE' });
      renderAnnouncements(new URLSearchParams());
    });
  });
}

/** Downscale large images in the browser before upload (keeps first TV sync fast). */
async function compressImage(file) {
  if (file.size <= 600 * 1024 || !/^image\/(png|jpeg|webp)$/.test(file.type)) return file;
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1920 / bmp.width, 1080 / bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
  return blob && blob.size < file.size
    ? new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' })
    : file;
}

async function renderSlides() {
  const rows = await api(mpath('/slides'));
  view.innerHTML = `
    <h1>Slides</h1>
    <div class="card"><h2>Upload slide</h2><form id="f" class="row">
      <div><label>Image (PNG/JPEG/WebP, max 2 MB, 16:9 recommended)</label><input type="file" name="image" accept="image/png,image/jpeg,image/webp" required /></div>
      <div><label>Caption</label><input name="caption" maxlength="200" /></div>
      <div><label>Seconds on screen</label><input type="number" name="durationSec" min="3" max="120" value="10" /></div>
      <div><button>Upload</button></div>
    </form></div>
    <div class="card"><table><thead><tr><th>Slide</th><th>Caption</th><th>Seconds</th><th>Shown</th><th></th></tr></thead><tbody>
      ${
        rows
          .map(
            (
              s,
            ) => `<tr><td><img class="thumb" src="${esc(s.url)}" alt="" /></td><td>${esc(s.caption ?? '')}</td><td>${s.durationSec}</td>
        <td><input type="checkbox" data-toggle="${s.id}" ${s.active ? 'checked' : ''} style="width:auto" /></td>
        <td><button class="danger" data-del="${s.id}">Delete</button></td></tr>`,
          )
          .join('') || '<tr><td colspan="5">No slides.</td></tr>'
      }
    </tbody></table></div>`;
  $('#f').onsubmit = guard(async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const file = await compressImage(fd.get('image'));
    if (file.size > MAX_SLIDE_BYTES) throw new Error('Image is larger than 2 MB even after compression');
    fd.set('image', file, file.name);
    await api(mpath('/slides'), { method: 'POST', body: fd });
    toast('Slide uploaded — remember to Publish');
    renderSlides();
  });
  view.querySelectorAll('[data-toggle]').forEach((c) => {
    c.onchange = guard(async () =>
      api(mpath(`/slides/${c.dataset.toggle}`), { method: 'PATCH', body: { active: c.checked } }),
    );
  });
  view.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = guard(async () => {
      if (!confirm('Delete this slide?')) return;
      await api(mpath(`/slides/${b.dataset.del}`), { method: 'DELETE' });
      renderSlides();
    });
  });
}

async function renderDevices() {
  const rows = await api(mpath('/devices'));
  view.innerHTML = `
    <h1>TV devices</h1>
    <div class="card"><h2>Pair a TV</h2>
      <p class="muted">Open <code>${esc(location.origin)}/tv/</code> on the TV. Type the 5-digit code it shows (valid for 10 minutes).</p>
      <form id="f" class="row">
        <div><label>Code on TV</label><input name="code" inputmode="numeric" pattern="\\d{5}" maxlength="5" required placeholder="12345" /></div>
        <div><label>TV name</label><input name="name" value="Prayer Hall TV" required /></div>
        <div><button>Pair TV</button></div>
      </form></div>
    <div class="card"><table><thead><tr><th>Name</th><th>Status</th><th class="hide-sm">Last seen</th><th>Version</th><th></th></tr></thead><tbody>
      ${
        rows
          .map(
            (
              d,
            ) => `<tr><td>${esc(d.name)}</td><td><span class="pill ${d.online ? 'online' : 'offline'}">${d.online ? 'online' : 'offline'}</span></td>
        <td class="hide-sm">${esc(fmtTime(d.lastSeenAt))}</td><td>${d.snapshotVersion ?? '—'} ${d.upToDate ? '✓' : ''}</td>
        <td><button class="danger" data-del="${d.id}">Remove</button></td></tr>`,
          )
          .join('') || '<tr><td colspan="5">No TVs paired.</td></tr>'
      }
    </tbody></table></div>`;
  $('#f').onsubmit = guard(async (e) => {
    e.preventDefault();
    await api(mpath('/devices/pair'), { method: 'POST', body: formData(e.target) });
    toast('TV paired! It will load the latest published display shortly.');
    renderDevices();
  });
  view.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = guard(async () => {
      if (!confirm('Remove this TV? It will return to the pairing screen.')) return;
      await api(mpath(`/devices/${b.dataset.del}`), { method: 'DELETE' });
      renderDevices();
    });
  });
}

async function renderUsers() {
  const [rows, invites] = await Promise.all([api(mpath('/users')), api(mpath('/invites'))]);
  const roles = role() === 'owner' ? ['editor', 'admin', 'owner'] : ['editor'];
  view.innerHTML = `
    <h1>Users</h1>
    <div class="card"><h2>Add user</h2><form id="f" class="row">
      <div><label>Email</label><input type="email" name="email" required /></div>
      <div><label>Name (new users)</label><input name="name" /></div>
      <div><label>Role</label><select name="role">${roles.map((r) => `<option>${r}</option>`).join('')}</select></div>
      <div><button>Invite / add</button></div>
    </form><p class="muted">New people get an email invitation (valid 7 days) to set their own password. People who already have an account are added straight away and notified. Editors update times, announcements and slides, and can publish. Admins also manage TVs, users, pause and audit. Owners manage everything.</p>
    <div id="temp"></div>
    ${invites.length ? `<h2>Pending invitations</h2><table><tbody>${invites.map((i) => `<tr><td>${esc(i.email)}</td><td>${esc(i.role)}</td><td class="muted">expires ${esc(fmtTime(i.expiresAt))}</td></tr>`).join('')}</tbody></table>` : ''}</div>
    <div class="card"><table><thead><tr><th>Name</th><th class="hide-sm">Email</th><th>Role</th><th></th></tr></thead><tbody>
      ${rows
        .map(
          (u) => `<tr><td>${esc(u.name)}</td><td class="hide-sm">${esc(u.email)}</td>
        <td>${
          RANK[u.role] < RANK[role()] || role() === 'owner'
            ? `<select data-role="${u.id}">${['editor', 'admin', 'owner'].map((r) => `<option ${r === u.role ? 'selected' : ''}>${r}</option>`).join('')}</select>`
            : esc(u.role)
        }</td>
        <td>${u.id !== state.user.id ? `<button class="danger" data-del="${u.id}">Remove</button>` : '<span class="muted">you</span>'}</td></tr>`,
        )
        .join('')}
    </tbody></table></div>`;
  $('#f').onsubmit = guard(async (e) => {
    e.preventDefault();
    const v = formData(e.target);
    const out = await api(mpath('/users'), { method: 'POST', body: { ...v, name: v.name || undefined } });
    await renderUsers();
    const what = out.status === 'invited' ? `Invitation emailed to ${out.email}` : `${out.email} added`;
    toast(out.emailSent ? what : `${what}, but the email could not be sent`, !out.emailSent);
  });
  view.querySelectorAll('[data-role]').forEach((s) => {
    s.onchange = guard(async () => {
      await api(mpath(`/users/${s.dataset.role}`), { method: 'PATCH', body: { role: s.value } });
      toast('Role updated');
    });
  });
  view.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = guard(async () => {
      if (!confirm('Remove this user from the mosque?')) return;
      await api(mpath(`/users/${b.dataset.del}`), { method: 'DELETE' });
      renderUsers();
    });
  });
}

async function renderAudit() {
  const rows = await api(mpath('/audit?limit=200'));
  view.innerHTML = `
    <h1>Audit log</h1>
    <div class="card"><p class="muted">Every change is recorded. This log cannot be edited or deleted.</p>
    <table><thead><tr><th>When</th><th>Who</th><th>Action</th><th class="hide-sm">Details</th></tr></thead><tbody>
      ${rows
        .map(
          (a) => `<tr><td>${esc(fmtTime(a.createdAt))}</td><td>${esc(a.userEmail ?? 'system')}</td>
        <td><code>${esc(a.action)}</code> ${a.entityId ? `<span class="muted">#${esc(a.entityId)}</span>` : ''}</td>
        <td class="hide-sm muted">${esc(a.details ? JSON.stringify(a.details).slice(0, 160) : '')}</td></tr>`,
        )
        .join('')}
    </tbody></table></div>`;
}

async function renderSettings() {
  const m = await api(mpath(''));
  view.innerHTML = `
    <h1>Settings</h1>
    <div class="card"><h2>Mosque</h2><form id="f">
      <label>Name</label><input name="name" value="${esc(m.name)}" ${atLeast('admin') ? '' : 'disabled'} required />
      <div class="row" style="margin-top:10px">
        <div><label>City</label><input name="city" value="${esc(m.city ?? '')}" ${atLeast('admin') ? '' : 'disabled'} /></div>
        <div><label>Timezone (IANA, e.g. Europe/London)</label><input name="timezone" value="${esc(m.timezone)}" ${atLeast('admin') ? '' : 'disabled'} required /></div>
      </div>
      ${atLeast('admin') ? '<p><button>Save</button></p>' : '<p class="muted">Only admins can change mosque settings.</p>'}
    </form></div>
    <div class="card"><h2>Change my password</h2><form id="pw" class="row">
      <div><label>Current password</label><input type="password" name="currentPassword" required /></div>
      <div><label>New password</label><input type="password" name="newPassword" minlength="8" required /></div>
      <div><button>Change</button></div>
    </form></div>
    <div class="card"><h2>Install on your phone</h2><p class="muted">Use your browser's "Add to Home screen" to install Masjid Pulse Admin as an app.</p></div>`;
  $('#f').onsubmit = guard(async (e) => {
    e.preventDefault();
    const v = formData(e.target);
    await api(mpath(''), { method: 'PATCH', body: { ...v, city: v.city || null } });
    await loadMe();
    toast('Saved — remember to Publish');
  });
  $('#pw').onsubmit = guard(async (e) => {
    e.preventDefault();
    const out = await api('/api/me/password', { method: 'POST', body: formData(e.target) });
    state.token = out.token;
    localStorage.setItem('mp_token', out.token);
    e.target.reset();
    toast('Password changed');
  });
}

// ---------------- Router ----------------

const routes = {
  today: renderToday,
  prayers: renderPrayers,
  jummah: renderJummah,
  announcements: renderAnnouncements,
  donations: renderDonations,
  slides: renderSlides,
  devices: renderDevices,
  users: renderUsers,
  audit: renderAudit,
  settings: renderSettings,
};

async function router() {
  const [name, query] = (location.hash.replace(/^#\/?/, '') || 'today').split('?');
  const params = new URLSearchParams(query || '');
  $('#nav').classList.remove('open');
  if (name === 'logout') return logout();
  const publicRoutes = {
    forgot: renderForgot,
    reset: renderReset,
    verify: renderVerify,
    'accept-invite': renderAcceptInvite,
  };
  if (publicRoutes[name]) {
    $('#topbar').hidden = true;
    return publicRoutes[name](params);
  }
  if (!state.token) {
    $('#topbar').hidden = true;
    return name === 'register' ? renderRegister() : renderLogin();
  }
  try {
    if (!state.user) await loadMe();
    $('#topbar').hidden = false;
    document.querySelectorAll('#nav a').forEach((a) => {
      a.classList.toggle('active', a.getAttribute('href') === `#/${name}`);
      if (a.dataset.min) a.hidden = !atLeast(a.dataset.min);
    });
    if (!state.mosqueId) {
      view.innerHTML = '<div class="card">Your account is not a member of any mosque.</div>';
      return;
    }
    view.innerHTML = '<p class="muted">Loading…</p>';
    await (routes[name] || renderToday)(params);
  } catch (e) {
    view.innerHTML = `<div class="status bad">${esc(e.message)}</div>`;
  }
}

$('#menu-btn').onclick = () => $('#nav').classList.toggle('open');
$('#mosque-switch').onchange = (e) => {
  state.mosqueId = Number(e.target.value);
  localStorage.setItem('mp_mosque', String(state.mosqueId));
  router();
};
window.addEventListener('hashchange', router);
router();

if ('serviceWorker' in navigator)
  navigator.serviceWorker.register('/admin/sw.js', { scope: '/admin/' }).catch(() => {});

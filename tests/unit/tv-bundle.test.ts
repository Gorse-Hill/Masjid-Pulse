// Old Smart-TV browser compatibility of the TV display (LG webOS 3.x = Chromium 38, webOS 4.x =
// Chromium 53). Checks the built bundle is plain ES5 (no modules), the HTML/CSS avoid features those
// engines lack, and the bundle actually runs in a sandbox where modern built-ins are removed.
import { describe, expect, it, beforeAll } from 'vitest';
import { parse } from 'acorn';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { buildTv } from '../../scripts/build-tv.mjs';
import { openDatabase } from '../../src/db/db.js';
import { seed } from '../../src/scripts/seed.js';
import { displaySnapshotFor } from '../../src/services/snapshot.js';

const PUBLIC = path.resolve(__dirname, '../../public/tv');
let bundle = '';

beforeAll(async () => {
  bundle = await buildTv({ write: false, minify: false });
}, 60_000);

describe('TV bundle (public/tv/app.js)', () => {
  it('parses as an ES5 classic script', () => {
    expect(() => parse(bundle, { ecmaVersion: 5, sourceType: 'script' })).not.toThrow();
  });

  it('index.html loads it as a classic script, not an ES module', () => {
    const html = readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
    expect(html).toContain('<script src="/tv/app.js"></script>');
    expect(html).not.toMatch(/type="module"/);
  });

  it('keeps the AG TECH developer and AHMED GORSE WAQAF donor credits visible', () => {
    const html = readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
    expect(html).toContain('Masjid Pulse is Designed &amp; Developed by AG TECH.');
    expect(html).toContain('Masjid Pulse is Donated by AHMED GORSE WAQAF.');
    expect(html).toContain('src="/brand/waqaf.jpg"');
    expect(html).not.toContain('Designed by Ahmed Gorse');
  });

  it('tv.css avoids CSS variables, flex/grid gap and grid (unsupported in Chromium 38-53)', () => {
    const css = readFileSync(path.join(PUBLIC, 'tv.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/var\(--/);
    expect(css).not.toMatch(/(^|[\s;{])(row-|column-)?gap\s*:/);
    expect(css).not.toMatch(/display\s*:\s*(inline-)?grid/);
    expect(css).not.toMatch(/\b(clamp|min|max)\(/);
  });

  it('runs from a cached snapshot with modern built-ins removed', () => {
    const db = openDatabase(':memory:');
    const { mosqueId } = seed(db, 'Africa/Mogadishu');
    const snapshot = displaySnapshotFor(db, mosqueId)!.snapshot;

    const elements: Record<
      string,
      { textContent: string; innerHTML: string; className: string; hidden: boolean }
    > = {};
    const el = (id: string) =>
      (elements[id] ??= { textContent: '', innerHTML: '', className: '', hidden: false });
    const storage: Record<string, string> = {
      mp_tv_token: JSON.stringify('device-token'),
      mp_tv_snapshot: JSON.stringify(snapshot),
    };
    const xhrSent: string[] = [];
    const sandbox: Record<string, unknown> = {
      document: { getElementById: el },
      location: { search: '', href: 'http://tv.local/tv/' },
      navigator: { userAgent: 'Mozilla/5.0 (Web0S; Linux/SmartTV) Chrome/38.0.2125.122' },
      localStorage: {
        getItem: (k: string) => (k in storage ? storage[k] : null),
        setItem: (k: string, v: string) => void (storage[k] = String(v)),
        removeItem: (k: string) => void delete storage[k],
      },
      // whatwg-fetch is built on XMLHttpRequest: the poll goes through it.
      XMLHttpRequest: class {
        open(_m: string, url: string) {
          xhrSent.push(url);
        }
        setRequestHeader() {}
        send() {}
        getAllResponseHeaders() {
          return '';
        }
      },
      setTimeout: () => 0,
      clearTimeout: () => {},
      setInterval: () => 0,
      addEventListener: () => {},
      console,
    };
    sandbox.window = sandbox;
    sandbox.self = sandbox;
    const ctx = vm.createContext(sandbox);
    // Simulate an old engine: remove built-ins that Chromium 38 lacks.
    vm.runInContext(
      `delete String.prototype.padStart; delete String.prototype.padEnd; delete Object.values;
       delete Object.entries; delete Array.prototype.includes; delete Array.prototype.flat;
       delete Intl.DateTimeFormat.prototype.formatToParts; delete globalThis.fetch;
       delete globalThis.URLSearchParams;`,
      ctx,
    );
    vm.runInContext(bundle, ctx, { filename: 'app.js' });

    expect(elements.display.hidden).toBe(false);
    expect(elements['mosque-name'].textContent).toContain('Masjid An-Noor (Demo)');
    expect(elements.clock.textContent).toMatch(/^\d\d:\d\d$/);
    expect(elements['prayer-rows'].innerHTML).toContain('Fajr');
    expect(elements['prayer-rows'].innerHTML).toContain('05:15');
    expect(xhrSent[0]).toContain('/api/tv/snapshot?version=');
    expect(vm.runInContext('typeof fetch', ctx)).toBe('function');
  });

  it('keeps the Waqaf flash hidden throughout Athan and Iqamah alerts', () => {
    let currentMs = Date.parse('2026-11-22T05:14:00+03:00');
    const MockDate = class extends Date {
      constructor(value?: string | number) {
        super(value === undefined ? currentMs : value);
      }
      static now() {
        return currentMs;
      }
    };
    const db = openDatabase(':memory:');
    const { mosqueId } = seed(db, 'Africa/Mogadishu', new Date(currentMs));
    const snapshot = displaySnapshotFor(db, mosqueId)!.snapshot;
    const elements: Record<
      string,
      { textContent: string; innerHTML: string; className: string; hidden: boolean }
    > = {};
    const el = (id: string) =>
      (elements[id] ??= { textContent: '', innerHTML: '', className: '', hidden: false });
    el('waqaf-flash').hidden = true;
    const intervals: Record<number, () => void> = {};
    const storage: Record<string, string> = {
      mp_tv_token: JSON.stringify('device-token'),
      mp_tv_snapshot: JSON.stringify(snapshot),
    };
    const sandbox: Record<string, unknown> = {
      Date: MockDate,
      document: { getElementById: el },
      location: { search: '', href: 'http://tv.local/tv/' },
      navigator: {},
      localStorage: {
        getItem: (k: string) => (k in storage ? storage[k] : null),
        setItem: (k: string, v: string) => void (storage[k] = String(v)),
        removeItem: (k: string) => void delete storage[k],
      },
      XMLHttpRequest: class {
        open() {}
        setRequestHeader() {}
        send() {}
        getAllResponseHeaders() {
          return '';
        }
      },
      setTimeout: () => 0,
      clearTimeout: () => {},
      setInterval: (fn: () => void, ms: number) => {
        intervals[ms] = fn;
        return 1;
      },
      addEventListener: () => {},
      console,
    };
    sandbox.window = sandbox;
    sandbox.self = sandbox;
    vm.runInContext(bundle, vm.createContext(sandbox), { filename: 'app.js' });

    const tick = intervals[1000];
    const flash = intervals[3 * 60 * 1000];
    flash();
    expect(el('waqaf-flash').hidden).toBe(false);

    currentMs = Date.parse('2026-11-22T05:15:00+03:00');
    tick();
    expect(el('adhan-banner').hidden).toBe(false);
    expect(el('waqaf-flash').hidden).toBe(true);
    flash();
    expect(el('waqaf-flash').hidden).toBe(true);

    currentMs = Date.parse('2026-11-22T05:16:00+03:00');
    tick();
    expect(el('next').className).toContain('iqamah');
    flash();
    expect(el('waqaf-flash').hidden).toBe(true);

    currentMs = Date.parse('2026-11-22T05:46:00+03:00');
    tick();
    expect(el('next').className).toContain('inprayer');
    flash();
    expect(el('waqaf-flash').hidden).toBe(true);

    currentMs = Date.parse('2026-11-22T06:30:00+03:00');
    tick();
    flash();
    expect(el('waqaf-flash').hidden).toBe(false);
    db.close();
  });
});

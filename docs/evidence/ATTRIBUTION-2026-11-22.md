# Attribution verification — 22 November 2026

## Scope

Verified the exact developer and donor statements on the public website, admin portal, TV welcome screen, and TV footer. The existing Waqaf brand asset is retained.

## Environment

- Node.js: v22.18.0
- npm: 10.9.3
- Browser: Chromium through Playwright

## Automated checks

Baseline before editing:

- `npm run format:check` — passed
- `npm run lint` — passed
- `npm run typecheck` — passed
- `npm run build` — passed; TV bundle generated as ES5 for Chromium 38+
- `npm test` — 8 test files passed, 132 tests passed

After editing:

- `npm run format:check` — passed
- `npm run lint` — passed
- `npm run typecheck` — passed
- `npm run build` — passed; TV bundle generated as ES5 for Chromium 38+
- `npm test` — 8 test files passed, 133 tests passed

The added regression test checks the exact AG TECH and AHMED GORSE WAQAF statements, the Waqaf brand asset reference, and removal of the former `Designed by Ahmed Gorse` TV credit.

## Browser checks

- Public website at 1440×1000: both statements visible; no horizontal overflow.
- Public website at 375×812: both statements visible; no horizontal overflow.
- Admin login at 1280×900: both statements visible; no horizontal overflow.
- TV welcome credit at 1920×1080: both statements and the Waqaf logo visible; no horizontal or vertical document overflow.
- TV main footer at 1920×1080: both statements visible inside the viewport.
- TV Waqaf credit at 1920×1080: the existing Waqaf logo remains visible inside the viewport.
- Browser console: zero errors and zero warnings during the captured checks.

// Polyfills for old Smart-TV browsers (LG webOS 3.x ships Chromium 38, which has no fetch).
// core-js polyfills (Promise, Object.values, String#padStart, Array#find, ...) are injected
// automatically by Babel (useBuiltIns: 'usage') during `npm run build:web`.
import 'whatwg-fetch';

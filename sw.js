// bitcointerminal.net service worker
// =====================================================================
// Strategy summary:
//   Static app shell  (/index.html, /rp.js)        : network-first, cache fallback
//   Versioned CDN     (Plotly, SheetJS, mp4-muxer) : cache-first (immutable)
//   Google Fonts      (fonts.gstatic.com)          : cache-first (versioned)
//   Historical API    (/api/urpd/<cohort>/<date>)  : cache-first (past data is immutable)
//   Daily-refresh API (/api/urpd/all/dates, series): stale-while-revalidate
//   Live spot         (api.binance.com)            : never cache (pass-through)
//   Everything else                                : pass-through
//
// Kill switch:
//   Visit any URL on this origin with ?nosw  -> SW unregisters itself.
// =====================================================================

const VERSION = 'v5';                                  // bump on every deploy
const PRECACHE  = `precache-${VERSION}`;
const RUNTIME   = `runtime-${VERSION}`;
const API_IMM   = `api-immutable-${VERSION}`;
const API_FRESH = `api-fresh-${VERSION}`;

const PRECACHE_URLS = ['/', '/index.html', '/rp.js'];

// Pattern → strategy router. Tested in order; first match wins.
const ROUTES = [
  // Live spot price — always fresh, do NOT intercept
  { match: u => /^https:\/\/api\.binance\.com\//.test(u), strategy: 'passthrough' },

  // Versioned CDN libs — immutable
  { match: u => /^https:\/\/(cdn\.plot\.ly|cdn\.sheetjs\.com|cdn\.jsdelivr\.net)\//.test(u), strategy: 'cacheFirst', cache: RUNTIME },

  // Google Fonts CSS + woff2
  { match: u => /^https:\/\/fonts\.googleapis\.com\//.test(u), strategy: 'staleWhileRevalidate', cache: RUNTIME },
  { match: u => /^https:\/\/fonts\.gstatic\.com\//.test(u),    strategy: 'cacheFirst',           cache: RUNTIME },

    // Bitview API: historical date paths /api/urpd/<cohort>/YYYY-MM-DD — past data is immutable
  // Examples: /api/urpd/all/2024-03-15, /api/urpd/age0_3m/2024-03-15, /api/urpd/lth/2024-03-15
  { match: u => /^https:\/\/bitview\.space\/api\/urpd\/[^/]+\/\d{4}-\d{2}-\d{2}(\?|$)/.test(u), strategy: 'cacheFirst', cache: API_IMM },

  // Bitview API: daily-refresh endpoints (dates list, time-series)
  { match: u => /^https:\/\/bitview\.space\/api\/(urpd\/all\/dates|series\/)/.test(u), strategy: 'staleWhileRevalidate', cache: API_FRESH },

  // Same-origin app shell (index.html, rp.js, anything else under /)
  { match: u => {
      try { return new URL(u).origin === self.location.origin; } catch (e) { return false; }
    }, strategy: 'networkFirst', cache: PRECACHE },
];

// =====================================================================
// Lifecycle
// =====================================================================

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(PRECACHE)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => !k.endsWith(VERSION))   // delete every cache from prior versions
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// =====================================================================
// Fetch routing
// =====================================================================

self.addEventListener('fetch', event => {
  const req = event.request;

  // Don't touch non-GET (e.g. POST to API)
  if (req.method !== 'GET') return;

  // Kill switch: ?nosw -> unregister & reload from network
  const url = new URL(req.url);
  if (url.searchParams.has('nosw')) {
    self.registration.unregister();
    return;  // pass-through this request
  }

  for (const route of ROUTES) {
    if (!route.match(req.url)) continue;
    if (route.strategy === 'passthrough') return;          // let browser handle
    if (route.strategy === 'cacheFirst')             event.respondWith(cacheFirst(req, route.cache));
    else if (route.strategy === 'networkFirst')      event.respondWith(networkFirst(req, route.cache));
    else if (route.strategy === 'staleWhileRevalidate') event.respondWith(staleWhileRevalidate(req, route.cache));
    return;
  }
  // No route matched — pass through
});

// =====================================================================
// Strategies
// =====================================================================

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch (e) {
    // Offline + nothing cached — return a synthetic 504
    return new Response('Offline', { status: 504, statusText: 'Offline (no cached copy)' });
  }
}

async function networkFirst(req, cacheName) {
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) {
      const cache = await caches.open(cacheName);
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch (e) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(req);
    if (cached) return cached;
    throw e;
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req).then(fresh => {
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  }).catch(() => cached);   // network failed → fall back to cached
  return cached || fetchPromise;
}

/**
 * Flow Service Worker
 *
 * Caching strategy:
 *  - Navigation requests (HTML pages)        → network-first, fallback to cache
 *    This prevents stale / wrong HTML being served from cache after a deploy,
 *    and is the root fix for the "request-demo.html shows wrong page" bug.
 *
 *  - Hashed assets (/assets/*)               → cache-first (filenames change on deploy)
 *  - /api/agrow/reference-data               → stale-while-revalidate (offline scanning)
 *  - All other API calls                     → network-first (always fresh data)
 *
 * Update flow:
 *  1. New SW installs but waits (does NOT auto-activate).
 *  2. App receives 'updatefound' / 'waiting' and shows an "Update available" banner.
 *  3. User clicks "Reload" → app sends SKIP_WAITING → SW activates → page reloads.
 *
 * To force-clear all caches on the next deploy: increment CACHE_VERSION.
 */

const CACHE_VERSION  = 2;                        // ← bumped to clear poisoned caches
const CACHE_NAME     = `flow-v${CACHE_VERSION}`;
const SHELL_URLS     = ['/', '/index.html'];
const REFERENCE_URLS = ['/api/agrow/reference-data'];

// ── Install: pre-cache shell — do NOT skipWaiting (let app control timing) ───
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_URLS)).catch(() => {})
  );
  // Do NOT call self.skipWaiting() here.
  // The app will send SKIP_WAITING when the user acknowledges the update.
});

// ── Message: handle SKIP_WAITING from app ─────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── Activate: clean old caches, take control of all clients ──────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => {
      // Notify all open tabs that a new version is now active
      return self.clients.matchAll({ type: 'window' }).then(clients =>
        clients.forEach(client => client.postMessage({ type: 'SW_ACTIVATED', version: CACHE_VERSION }))
      );
    })
  );
  self.clients.claim();
});

// ── Fetch strategy ────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Reference data: stale-while-revalidate (critical for offline scanning)
  if (REFERENCE_URLS.some(u => url.pathname.startsWith(u))) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // API calls: network-first (always get fresh data)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // HTML navigation requests: ALWAYS network-first.
  //
  // This is the critical fix.  The old code used cacheFirst for every non-API
  // request, which meant that if a browser ever received the React SPA
  // (index.html) for a marketing page like /request-demo.html — because the
  // SPA wildcard catch-all intercepted the request before the explicit route
  // was added — that wrong response would be stuck in cache and served on
  // every subsequent visit even after the server was fixed.
  //
  // Network-first for navigate requests means the browser always fetches fresh
  // HTML.  The cached version is only used when offline.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  // Hashed static assets (/assets/*.js, /assets/*.css, etc.): cache-first.
  // Vite's build output uses content-hashed filenames so stale content is
  // never an issue.  Fonts, images, and other non-hashed assets also benefit
  // from caching.
  event.respondWith(cacheFirst(request));
});

// ── Background sync (offline scan queue) ─────────────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-scans') {
    event.waitUntil(syncOfflineScans());
  }
});

async function syncOfflineScans() {
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(client => client.postMessage({ type: 'TRIGGER_SYNC' }));
}

// ── Hourly sync alarm (where supported) ──────────────────────────────────────
self.addEventListener('periodicsync', event => {
  if (event.tag === 'hourly-sync') {
    event.waitUntil(syncOfflineScans());
  }
});

// ── Strategy helpers ──────────────────────────────────────────────────────────
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    // Only cache successful responses; don't cache error pages
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    // For navigate requests, return a minimal offline page
    if (request.mode === 'navigate') {
      return new Response(
        '<!doctype html><html><body><p>You are offline. Please check your connection.</p></body></html>',
        { status: 503, headers: { 'Content-Type': 'text/html' } }
      );
    }
    return new Response(JSON.stringify({ error: 'Offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const networkPromise = fetch(request).then(response => {
    if (response.ok) {
      caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
    }
    return response;
  }).catch(() => null);
  return cached || networkPromise;
}

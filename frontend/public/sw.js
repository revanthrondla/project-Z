/**
 * Flow Service Worker
 *
 * Strategy:
 *  - App shell (HTML/JS/CSS): cache-first with network fallback
 *  - API calls to /api/agrow/reference-data: stale-while-revalidate (needed offline for scan dropdowns)
 *  - All other API calls: network-first (fresh data when online)
 *  - POST /api/agrow/scanned-products/sync: queued for background sync when offline
 */

const CACHE_NAME     = 'agrow-v1';
const SHELL_URLS     = ['/', '/index.html'];
const REFERENCE_URLS = ['/api/agrow/reference-data'];

// ── Install: pre-cache shell ──────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_URLS)).catch(() => {})
  );
  self.skipWaiting();
});

// ── Activate: clean old caches ────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
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

  // Other API calls: network first
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // App shell assets: cache first
  event.respondWith(cacheFirst(request));
});

// ── Background sync (offline scan queue) ─────────────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-scans') {
    event.waitUntil(syncOfflineScans());
  }
});

async function syncOfflineScans() {
  // Notify all clients to trigger sync
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
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response(JSON.stringify({ error: 'Offline' }), {
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

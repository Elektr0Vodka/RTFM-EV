// Wardrive page service worker (scope /wardrive/). It keeps the page usable
// when RTFM-EV cannot be reached mid-drive: the page and its hashed assets
// are cached, navigations go to the network first and fall back to the
// cached page. It never touches /api/: uploads wait in the page's own queue.
// The server varies on Origin (CORS) and Accept-Encoding, but the page's
// crossorigin asset requests carry an Origin the precache requests did not:
// matches ignore Vary. Assets are content-hashed and the page is one file.
const CACHE = 'rtfm-wardrive-v1';
const PAGE_KEY = './';
// Paths from the worker's own scope (<prefix>/wardrive/), so a reverse-proxy
// sub-path works: the API sits beside the page, the assets below it.
const API_PATH = new URL('../api/', self.registration.scope).pathname;
const ASSETS_PATH = new URL('./assets/', self.registration.scope).pathname;
// The page's own copies of the app fonts (cache-first, listed in assets.json).
const FONTS_PATH = new URL('./fonts/', self.registration.scope).pathname;
const isBuildFile = (p) => p.startsWith(ASSETS_PATH) || p.startsWith(FONTS_PATH);
// How long a page load waits for the network before the cached page opens.
const NAV_TIMEOUT_MS = 4000;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        for (const name of await caches.keys()) {
          if (name.startsWith('rtfm-wardrive-') && name !== CACHE) await caches.delete(name);
        }
      } catch {
        // Cache storage unavailable; take control anyway.
      }
      await self.clients.claim();
    })()
  );
});

// The page asks for a precache after every load, since the first load
// happened before this worker was in control.
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'wardrive-precache') return;
  event.waitUntil(precache());
});

// Stores the page together with every file of its build (the build lists
// them in assets.json), all or nothing, so the cached page never points at
// files the cache lacks; files already cached are not fetched again. Then
// the files of older builds go. Offline, or with any file missing, the cache
// stays as it was and the next load tries again.
async function precache() {
  let cache;
  try {
    cache = await caches.open(CACHE);
  } catch {
    return; // Cache storage unavailable: no offline copy this time.
  }
  try {
    const listRes = await fetch(new URL('./assets.json', self.registration.scope), {
      cache: 'no-store',
    });
    if (!listRes.ok) return;
    const assets = (await listRes.json()).assets.map(
      (a) => new URL(a, self.registration.scope).href
    );
    const page = await fetch(new URL(PAGE_KEY, self.registration.scope), {
      credentials: 'same-origin',
    });
    if (!page.ok) return;
    const fetched = [];
    for (const url of assets) {
      if (await cache.match(url, { ignoreVary: true })) continue;
      const res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) return;
      fetched.push([url, res]);
    }
    for (const [url, res] of fetched) await cache.put(url, res);
    await cache.put(PAGE_KEY, page);
    const keep = new Set(assets.map((u) => new URL(u).pathname));
    for (const req of await cache.keys()) {
      const p = new URL(req.url).pathname;
      if (isBuildFile(p) && !keep.has(p)) await cache.delete(req);
    }
  } catch {
    // Offline right now; the next load tries again.
  }
}

// The browser may refuse its cache storage (storage pressure, a broken
// profile). The page must still load from the network then, so cache reads
// and writes never fail a request.
async function cached(key) {
  try {
    return await (await caches.open(CACHE)).match(key, { ignoreVary: true });
  } catch {
    return undefined;
  }
}

async function store(key, res) {
  try {
    await (await caches.open(CACHE)).put(key, res);
  } catch {
    // Not cached this time; the network answer is still used.
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith(API_PATH)) return;

  if (req.mode === 'navigate') {
    // The network first, but not forever: on a stalled link the cached page
    // opens after NAV_TIMEOUT_MS. A late answer is not stored: the page that
    // opened asks for a precache, which stores the new page with its files.
    // A server error (a proxy while RTFM-EV is down) gives way to the cached
    // page too. Without a cached page it keeps waiting for the network.
    event.respondWith(
      (async () => {
        const network = fetch(req);
        network.catch(() => undefined);
        const slow = new Promise((resolve) => setTimeout(() => resolve(null), NAV_TIMEOUT_MS));
        let res;
        try {
          res = await Promise.race([network, slow]);
          if (res === null) {
            const page = await cached(PAGE_KEY);
            if (page) return page;
            res = await network;
          }
        } catch {
          return (await cached(PAGE_KEY)) || Response.error();
        }
        if (res.status >= 500) return (await cached(PAGE_KEY)) || res;
        if (res.ok) await store(PAGE_KEY, res.clone());
        return res;
      })()
    );
    return;
  }

  if (isBuildFile(url.pathname)) {
    event.respondWith(
      (async () => {
        const hit = await cached(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) await store(req, res.clone());
        return res;
      })()
    );
  }
});

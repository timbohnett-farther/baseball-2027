// Service worker template: vite.config.ts fills PRECACHE and VERSION at build time and emits it as /sw.js.
// It caches the app shell so the game opens offline. It never touches /api or /health: game state always comes from the server.
const VERSION = "__VERSION__";
const CACHE = `bb-shell-${VERSION}`;
const PRECACHE = __PRECACHE__;

self.addEventListener("install", (e) => {
  // No skipWaiting here: a new version waits until the player taps "Update" (or relaunches), so it never swaps code mid-game.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("bb-shell-") && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("message", (e) => { if (e.data === "skip-waiting") self.skipWaiting(); });

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/") || url.pathname === "/health") return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("/index.html")));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    // Hashed build assets are immutable, so cache whatever the shell asks for later (lazy chunks).
    if (res.ok && url.pathname.startsWith("/assets/")) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  })));
});

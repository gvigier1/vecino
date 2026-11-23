// Service worker minimal : met en cache l'interface pour un démarrage rapide. L'API n'est jamais mise en cache.
const CACHE = "vecino-v2";
const SHELL = ["./", "static/style.css?v=2", "static/app.js?v=2", "static/icon.svg", "manifest.json"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname.includes("/api/") || url.pathname.endsWith("config.js") || url.origin !== location.origin) return;
  // réseau d'abord, cache en secours (hors ligne)
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request)));
});

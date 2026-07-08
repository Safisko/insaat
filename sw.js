/* Soylu İnşaat PWA service worker.
   Strateji: HER ZAMAN önce ağ (network-first) — GitHub'a yeni sürüm yüklenince kullanıcı hep yenisini görür.
   Önbellek sadece çevrimdışı yedek olarak kullanılır. ASLA cache-first'e çevirme (eski sürüm takılması yaşanır). */
const CACHE = "soylu-v1";
self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        const copy = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});

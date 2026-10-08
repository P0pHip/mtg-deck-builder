// Service worker : l'appli s'ouvre même hors ligne ; les images de cartes sont mises en cache.
const VERSION = "mtg-v1";
const SHELL = ["./", "index.html", "style.css", "manifest.webmanifest", "collection_exemple.csv",
  "js/app.js", "js/builder.js", "js/store.js", "js/scryfall.js", "js/i18n.js",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];
const IMG_CACHE = "mtg-images";
const IMG_MAX = 600;

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== IMG_CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function trimImages() {
  const c = await caches.open(IMG_CACHE);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - IMG_MAX; i++) await c.delete(keys[i]);
}

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // API Scryfall : toujours le réseau (les données sont déjà en cache dans IndexedDB)
  if (url.hostname === "api.scryfall.com") return;
  // Images de cartes : cache d'abord
  if (url.hostname === "cards.scryfall.io") {
    e.respondWith(caches.open(IMG_CACHE).then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const resp = await fetch(e.request);
      if (resp.ok || resp.type === "opaque") { c.put(e.request, resp.clone()); trimImages(); }
      return resp;
    }));
    return;
  }
  // Fichiers de l'appli : réseau d'abord (mises à jour), cache si hors ligne
  if (url.origin === location.origin) {
    e.respondWith(fetch(e.request).then(resp => {
      const copy = resp.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return resp;
    }).catch(() => caches.match(e.request).then(r => r || caches.match("index.html"))));
  }
});

// Service worker : l'appli s'ouvre hors ligne ; images de cartes et moteur IA mis en cache.
const VERSION = "mtg-v3";
const RUNTIME = "mtg-runtime";
const IMAGES = "mtg-images";
const IMG_MAX = 600;

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(["./", "index.html", "manifest.webmanifest", "collection_exemple.csv"])).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  const keep = [VERSION, RUNTIME, IMAGES, "mtg-models"];
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => !keep.includes(k)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function cacheFirst(cacheName, request, max) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const resp = await fetch(request);
  if (resp.ok || resp.type === "opaque") {
    cache.put(request, resp.clone());
    if (max) cache.keys().then(keys => keys.slice(0, Math.max(0, keys.length - max)).forEach(k => cache.delete(k)));
  }
  return resp;
}

self.addEventListener("fetch", e => {
  const { request } = e;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.hostname === "api.scryfall.com" || url.hostname.endsWith("huggingface.co") || url.hostname.endsWith("hf.co")) return;
  if (url.hostname === "cards.scryfall.io" || url.hostname === "svgs.scryfall.io") { e.respondWith(cacheFirst(IMAGES, request, IMG_MAX)); return; }
  // moteur LiteRT-LM (URL versionnée, immuable) : gardé pour l'IA hors ligne
  if (url.hostname === "cdn.jsdelivr.net" && url.pathname.includes("@litert-lm")) { e.respondWith(cacheFirst(RUNTIME, request)); return; }
  // lecture de texte du scanner (Tesseract : moteur + langues, URL versionnées)
  if (url.hostname === "cdn.jsdelivr.net" && /tesseract/.test(url.pathname)) { e.respondWith(cacheFirst(RUNTIME, request)); return; }
  if (url.origin === location.origin) {
    // fichiers de l'appli : réseau d'abord (mises à jour), cache si hors ligne
    e.respondWith(fetch(request).then(resp => {
      if (resp.ok) { const copy = resp.clone(); caches.open(VERSION).then(c => c.put(request, copy)); }
      return resp;
    }).catch(() => caches.match(request).then(r => r || caches.match("index.html"))));
  }
});

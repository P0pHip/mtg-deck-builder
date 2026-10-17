// Espace utilisé par l'appli sur l'appareil, mesuré partie par partie (le total vient du navigateur).
//   appli : fichiers de l'appli gardés pour le hors ligne (cache « mtg-vN » du service worker)
//   moteurs : moteur de l'IA (LiteRT-LM) et lecture des cartes (Tesseract), cache « mtg-runtime »
//   modèle : fichier du modèle de l'IA (système de fichiers privé, ou cache « mtg-models » en repli)
//   combos : base des combos téléchargée (cache « mtg-combos », voir data/comboBase.js)
//   images : images de cartes (« mtg-images-v2 » ; l'ancien « mtg-images » gardait des réponses opaques, voir sw.js)
//   données : collection, decks, envies… (IndexedDB — détail donné par Chrome seulement)

/** Octets d'un ou plusieurs caches. `readBodies` : lire le contenu quand la taille n'est pas annoncée (petits fichiers). */
async function cacheBytes(match, { readBodies = true } = {}) {
  let bytes = 0, opaque = 0;
  if (!globalThis.caches) return { bytes, opaque };
  for (const name of (await caches.keys()).filter(match)) {
    const cache = await caches.open(name);
    for (const req of await cache.keys()) {
      const resp = await cache.match(req);
      if (!resp) continue;
      if (resp.type === "opaque") { opaque++; continue; } // taille illisible (et comptée ≈7 Mo par Chrome)
      const len = +resp.headers.get("content-length");
      bytes += len > 0 ? len : readBodies ? (await resp.blob()).size : 0;
    }
  }
  return { bytes, opaque };
}

/** Octets d'un dossier du système de fichiers privé (OPFS), sous-dossiers compris. */
async function opfsBytes(dir) {
  let n = 0;
  for await (const h of dir.values()) n += h.kind === "file" ? (await h.getFile()).size : await opfsBytes(h);
  return n;
}

/**
 * { total, quota, app, engines, model, combos, images, oldImages, data, other } en octets (null = inconnu).
 * oldImages : nombre d'images de l'ancien cache opaque ; other : écart entre le total et ce qui est mesuré.
 */
export async function measureStorage() {
  const est = navigator.storage?.estimate ? await navigator.storage.estimate().catch(() => ({})) : {};
  const [app, engines, images, modelCache, combos] = await Promise.all([
    cacheBytes(n => /^mtg-v\d+$/.test(n)),
    cacheBytes(n => n === "mtg-runtime"),
    cacheBytes(n => n.startsWith("mtg-images")),
    cacheBytes(n => n === "mtg-models", { readBodies: false }), // ≈2 Go : jamais lu en mémoire
    cacheBytes(n => n === "mtg-combos"),
  ]);
  let opfs = 0;
  try { opfs = await opfsBytes(await navigator.storage.getDirectory()); } catch { /* pas d'OPFS */ }
  const model = opfs + modelCache.bytes;
  const data = est.usageDetails?.indexedDB ?? null;
  const measured = app.bytes + engines.bytes + model + combos.bytes + images.bytes + (data || 0);
  return {
    total: est.usage ?? null, quota: est.quota ?? null, app: app.bytes, engines: engines.bytes, model,
    combos: combos.bytes, images: images.bytes, oldImages: images.opaque, data, other: est.usage != null ? Math.max(0, est.usage - measured) : null,
  };
}

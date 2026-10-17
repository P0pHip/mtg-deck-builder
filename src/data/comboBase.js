// Base des combos de Commander Spellbook gardée sur l'appareil, pour trouver les combos sans passer par leur serveur
// (qui n'accepte les recherches que de son propre site). Facultative, mise à jour ou supprimée à tout moment, comme le modèle de l'IA.
// Leur fichier complet (≈30 Mo à télécharger, ≈690 Mo une fois décompressé) est lu au fil de l'eau ; on en garde ≈6 Mo,
// compressés, dans le cache « mtg-combos » : l'index (cartes de chaque combo) et les textes par paquets, lus à la demande.
import { comboBaseBuilder, comboDetails, comboFromBase, matchCombos, variantSplitter } from "../core/comboBase.js";

export const COMBO_BASE_URL = "https://json.commanderspellbook.com/variants.json.gz";
export const COMBO_CACHE = "mtg-combos";
export const COMBO_DOWNLOAD_BYTES = 30e6;
const RATIO = 23.5; // texte décompressé ≈ 23,5 × le fichier téléchargé : sert seulement à estimer la progression
const META = "combo-base/meta";
const part = (stamp, name) => `combo-base/${stamp}/${name}`;

let mem = null; // { stamp, index, packs: Map } : index chargé et paquets déjà lus

export const comboBaseSupported = () =>
  !!(globalThis.caches && globalThis.CompressionStream && globalThis.DecompressionStream && globalThis.TextDecoderStream);

async function gzipJSON(value) {
  return new Response(new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream("gzip"))).blob();
}
async function gunzipJSON(resp) {
  return JSON.parse(await new Response(resp.body.pipeThrough(new DecompressionStream("gzip"))).text());
}
const put = (cache, key, blob, type = "application/gzip") =>
  cache.put(key, new Response(blob, { headers: { "Content-Type": type, "Content-Length": String(blob.size) } }));

/** Corps de la réponse → texte, décompressé si le navigateur ne l'a pas déjà fait (il le fait quand le serveur l'annonce). */
async function textStream(body) {
  const reader = body.getReader();
  const first = await reader.read();
  const stream = new ReadableStream({
    start(c) { if (!first.done) c.enqueue(first.value); else c.close(); },
    async pull(c) { const { done, value } = await reader.read(); if (done) c.close(); else c.enqueue(value); },
    cancel(r) { return reader.cancel(r); },
  });
  const gz = first.value?.[0] === 0x1f && first.value?.[1] === 0x8b;
  return (gz ? stream.pipeThrough(new DecompressionStream("gzip")) : stream).pipeThrough(new TextDecoderStream());
}

/** Base présente : { stamp, source (date des données), at (téléchargée le), count (combos), bytes } ou null. */
export async function comboBaseInfo() {
  if (!comboBaseSupported() || !(await caches.has(COMBO_CACHE))) return null;
  const r = await (await caches.open(COMBO_CACHE)).match(META);
  return r ? r.json() : null;
}

async function removeStamp(cache, stamp) {
  for (const req of await cache.keys()) if (req.url.includes(`combo-base/${stamp}/`)) await cache.delete(req);
}

/**
 * Télécharge (ou met à jour) la base. `onProgress(part 0…1 estimée, combos lus)` ; `signal` pour annuler.
 * L'ancienne base reste utilisable jusqu'à ce que la nouvelle soit complète ; un échec ne laisse rien derrière lui.
 */
export async function downloadComboBase({ onProgress = () => {}, signal } = {}) {
  const resp = await fetch(COMBO_BASE_URL, { signal });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const total = (+resp.headers.get("content-length") || COMBO_DOWNLOAD_BYTES) * RATIO;
  const stamp = Date.now().toString(36);
  const cache = await caches.open(COMBO_CACHE);
  const split = variantSplitter(), build = comboBaseBuilder();
  let read = 0, bytes = 0, packs = 0, source = null;
  const savePacks = async () => {
    for (const p of build.takePacks()) {
      const blob = await gzipJSON(p);
      bytes += blob.size;
      await put(cache, part(stamp, `d${packs++}`), blob);
    }
  };
  try {
    const reader = (await textStream(resp.body)).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!source) source = value.match(/"timestamp":\s*"([^"]+)"/)?.[1] || null;
      read += value.length;
      for (const v of split.push(value)) build.add(v);
      await savePacks();
      onProgress(Math.min(0.99, read / total), build.count);
    }
    if (!split.complete) throw new Error("truncated");
    const index = build.done();
    await savePacks();
    if (!index.v.length) throw new Error("no-combos");
    const blob = await gzipJSON(index);
    bytes += blob.size;
    await put(cache, part(stamp, "index"), blob);
    const old = await comboBaseInfo();
    const meta = { stamp, source, at: Date.now(), count: index.v.length, bytes };
    await put(cache, META, new Blob([JSON.stringify(meta)]), "application/json");
    if (old && old.stamp !== stamp) await removeStamp(cache, old.stamp);
    mem = null;
    return meta;
  } catch (e) {
    await removeStamp(cache, stamp).catch(() => {});
    throw e;
  }
}

/** Supprime la base de l'appareil. */
export async function removeComboBase() {
  mem = null;
  if (globalThis.caches) await caches.delete(COMBO_CACHE);
}

async function load() {
  const info = await comboBaseInfo();
  if (!info) return null;
  if (mem?.stamp === info.stamp) return mem;
  const r = await (await caches.open(COMBO_CACHE)).match(part(info.stamp, "index"));
  if (!r) return null;
  mem = { stamp: info.stamp, index: await gunzipJSON(r), packs: new Map() };
  return mem;
}

/**
 * Combos complets ou à une carte près pour ces cartes, d'après la base de l'appareil (null si elle n'est pas là).
 * Sans leurs textes : `fillComboDetails` les ajoute pour ceux qu'on affiche.
 */
export async function searchComboBase(names, identity = null) {
  const m = await load();
  if (!m) return null;
  return matchCombos(m.index, names, identity).map(i => ({ ...comboFromBase(m.index, i), base: m.stamp }));
}

/** Ajoute (sur place) l'id, le déroulé, les prérequis… des combos venus de la base qui ne les ont pas encore. */
export async function fillComboDetails(list) {
  const todo = list.filter(v => v.ref != null && v.id == null);
  if (!todo.length) return list;
  const m = await load();
  if (!m) return list;
  const cache = await caches.open(COMBO_CACHE);
  for (const v of todo) {
    if (v.base !== m.stamp) continue; // base mise à jour depuis la recherche : numéros périmés
    const p = Math.floor(v.ref / m.index.pack);
    if (!m.packs.has(p)) {
      const r = await cache.match(part(m.stamp, `d${p}`));
      m.packs.set(p, r ? await gunzipJSON(r) : []);
    }
    const d = m.packs.get(p)[v.ref % m.index.pack];
    if (d) Object.assign(v, comboDetails(d));
  }
  return list;
}

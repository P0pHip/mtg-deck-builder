// Stockage local du modèle (≈2 Go) dans le système de fichiers privé du navigateur (OPFS).
// - téléchargement avec progression, reprise automatique si la connexion coupe (requêtes Range) ;
// - repli sur le Cache API si OPFS n'est pas disponible en écriture.
import { kvDelete, kvGet, kvSet } from "../data/db.js";

const DIR = "models";
const CACHE = "mtg-models";
const metaKey = id => `model:${id}`;

const hasOPFS = () => !!navigator.storage?.getDirectory && "createWritable" in (globalThis.FileSystemFileHandle?.prototype || {});

async function opfsDir() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(DIR, { create: true });
}

/** État du modèle : { status: "absent" | "partial" | "ready", bytes, total } */
export async function getStatus(model) {
  const meta = (await kvGet(metaKey(model.id))) || null;
  if (!meta) return { status: "absent", bytes: 0, total: model.approxBytes };
  if (meta.complete) return { status: "ready", bytes: meta.total, total: meta.total, backend: meta.backend };
  let bytes = 0;
  if (meta.backend === "opfs") {
    try { bytes = (await (await (await opfsDir()).getFileHandle(model.file)).getFile()).size; } catch { bytes = 0; }
  }
  return { status: bytes ? "partial" : "absent", bytes, total: meta.total || model.approxBytes, backend: meta.backend };
}

/**
 * Télécharge le modèle. `onProgress(bytes, total)` ; `signal` (AbortController) pour annuler.
 * Reprend un téléchargement partiel quand c'est possible.
 */
export async function download(model, { onProgress = () => {}, signal } = {}) {
  if (hasOPFS()) return downloadOPFS(model, onProgress, signal);
  return downloadCache(model, onProgress, signal);
}

async function downloadOPFS(model, onProgress, signal) {
  const dir = await opfsDir();
  const handle = await dir.getFileHandle(model.file, { create: true });
  let offset = (await handle.getFile()).size;
  const meta = (await kvGet(metaKey(model.id))) || {};
  if (meta.complete) return;

  const headers = offset ? { Range: `bytes=${offset}-` } : {};
  const resp = await fetch(model.url, { headers, signal });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  if (offset && resp.status !== 206) offset = 0; // le serveur ignore Range : on repart de zéro
  const range = resp.headers.get("content-range"); // "bytes 100-199/2000"
  const total = range ? +range.split("/")[1] : offset + (+resp.headers.get("content-length") || model.approxBytes - offset);
  await kvSet(metaKey(model.id), { backend: "opfs", total, complete: false });

  const writable = await handle.createWritable({ keepExistingData: offset > 0 });
  if (offset) await writable.seek(offset); else await writable.truncate(0);
  let bytes = offset, last = 0;
  const reader = resp.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await writable.write(value);
      bytes += value.byteLength;
      if (bytes - last > 4e6) { onProgress(bytes, total); last = bytes; }
    }
    await writable.close();
  } catch (e) {
    try { await writable.close(); } catch { /* fichier partiel conservé pour reprise */ }
    throw e;
  }
  onProgress(bytes, total);
  if (total && bytes < total) throw new Error("incomplete");
  await kvSet(metaKey(model.id), { backend: "opfs", total: bytes, complete: true });
}

async function downloadCache(model, onProgress, signal) {
  const resp = await fetch(model.url, { signal });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const total = +resp.headers.get("content-length") || model.approxBytes;
  await kvSet(metaKey(model.id), { backend: "cache", total, complete: false });
  let bytes = 0, last = 0;
  const counted = resp.body.pipeThrough(new TransformStream({
    transform(chunk, ctrl) {
      bytes += chunk.byteLength;
      if (bytes - last > 4e6) { onProgress(bytes, total); last = bytes; }
      ctrl.enqueue(chunk);
    },
  }));
  const cache = await caches.open(CACHE);
  await cache.put(model.url, new Response(counted, { headers: { "content-length": String(total) } }));
  onProgress(bytes, total);
  await kvSet(metaKey(model.id), { backend: "cache", total: bytes, complete: true });
}

/** Le modèle sous forme de Blob (lu depuis le disque à la demande, sans tout charger en mémoire). */
export async function getBlob(model) {
  const meta = await kvGet(metaKey(model.id));
  if (!meta?.complete) throw new Error("model-not-downloaded");
  if (meta.backend === "opfs") return (await (await opfsDir()).getFileHandle(model.file)).getFile();
  const resp = await (await caches.open(CACHE)).match(model.url);
  if (!resp) throw new Error("model-not-downloaded");
  return resp.blob();
}

export async function remove(model) {
  try { await (await opfsDir()).removeEntry(model.file); } catch { /* absent */ }
  try { await (await caches.open(CACHE)).delete(model.url); } catch { /* absent */ }
  await kvDelete(metaKey(model.id));
}

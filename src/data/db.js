// Accès bas niveau à IndexedDB (base locale du navigateur).
// Le nom et le schéma sont conservés depuis la v1 mobile : les données existantes sont reprises telles quelles.
const DB_NAME = "mtg-deck-builder";
let dbp = null;

function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore("collection", { keyPath: "name" });
        d.createObjectStore("decks", { keyPath: "id" });
        d.createObjectStore("kv");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

export async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then(r => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
export const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

// ------------------------------------------------------------------ clé / valeur (caches)
export const kvGet = key => tx("kv", "readonly", s => reqP(s.get(key)));
export const kvSet = (key, value) => tx("kv", "readwrite", s => { s.put(value, key); });
export const kvDelete = key => tx("kv", "readwrite", s => { s.delete(key); });

/** Pour les tests : ferme la connexion (une nouvelle sera ouverte au prochain appel). */
export async function _resetConnection() {
  if (dbp) (await dbp).close();
  dbp = null;
}

// Stockage local (IndexedDB) : collection, decks enregistrés, cache Scryfall.
// Tout reste sur le téléphone ; une sauvegarde JSON permet de transférer / restaurer.
import { BASIC_NAMES } from "./builder.js";

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

async function tx(store, mode, fn) {
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
const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

// ------------------------------------------------------------------ kv / cache
export const kvGet = key => tx("kv", "readonly", s => reqP(s.get(key)));
export const kvSet = (key, value) => tx("kv", "readwrite", s => { s.put(value, key); });

// ----------------------------------------------------------------- collection
export const loadCollection = () => tx("collection", "readonly", s => reqP(s.getAll()));

export function saveCollection(cards) {
  return tx("collection", "readwrite", s => { s.clear(); for (const c of cards) s.put(c); });
}

export async function getCard(name) {
  return tx("collection", "readonly", s => reqP(s.get(name)));
}

/** Fixe la quantité (0 = retirée). `card` = données si la carte est nouvelle. Retourne la quantité. */
export async function setQuantity(name, quantity, card = null) {
  const cur = await getCard(name);
  return tx("collection", "readwrite", s => {
    if (quantity <= 0) { s.delete(name); return 0; }
    if (cur) { s.put({ ...cur, quantity }); return quantity; }
    if (card) { s.put({ ...card, quantity }); return quantity; }
    return null;
  });
}

// ----------------------------------------------------------------------- decks
export function deckCards(deck) {
  const c = {};
  for (const card of deck.cards) {
    if (BASIC_NAMES.has(card.name)) continue;
    const n = card.count - (card.missing || 0); // on ne réserve que les exemplaires possédés
    if (n > 0) c[card.name] = (c[card.name] || 0) + n;
  }
  if (deck.commander) c[deck.commander.name] = (c[deck.commander.name] || 0) + 1;
  return c;
}

const pad = n => String(n).padStart(2, "0");
function localStamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export async function listDecks() {
  const all = await tx("decks", "readonly", s => reqP(s.getAll()));
  return all.sort((a, b) => b.saved_at.localeCompare(a.saved_at));
}

export async function saveDeck(name, deck, id = null) {
  const clean = { ...deck }; delete clean.suggestion;
  const entry = {
    id: id || Math.random().toString(16).slice(2, 10),
    name, format: deck.format, saved_at: localStamp(), deck: clean,
  };
  await tx("decks", "readwrite", s => { s.put(entry); });
  return entry;
}

export async function deleteDeck(id) {
  const d = await tx("decks", "readonly", s => reqP(s.get(id)));
  if (!d) return null;
  await tx("decks", "readwrite", s => { s.delete(id); });
  return d;
}

/** {nomCarte: [{id, name, count}]} : dans quels decks enregistrés chaque carte est rangée. */
export async function reservations(excludeId = null) {
  const res = {};
  for (const d of await listDecks()) {
    if (d.id === excludeId) continue;
    for (const [name, n] of Object.entries(deckCards(d.deck))) (res[name] ||= []).push({ id: d.id, name: d.name, count: n });
  }
  return res;
}

export function availableSync(collection, res) {
  const out = [];
  for (const c of collection) {
    const free = c.quantity - (res[c.name] || []).reduce((a, r) => a + r.count, 0);
    if (free > 0) out.push({ ...c, quantity: free });
  }
  return out;
}

export async function available(collection, excludeId = null) {
  return availableSync(collection, await reservations(excludeId));
}

export async function borrowReport(deck, collection, excludeId = null) {
  const res = await reservations(excludeId);
  const free = Object.fromEntries(availableSync(collection, res).map(c => [c.name, c.quantity]));
  const out = [];
  for (const [name, n] of Object.entries(deckCards(deck))) {
    const missing = n - (free[name] || 0);
    if (missing > 0 && res[name]) out.push({ name, count: missing, decks: res[name] });
  }
  return out;
}

// ----------------------------------------------------------------- sauvegarde
export async function exportBackup() {
  return { app: "mtg-deck-builder", version: 1, exported_at: new Date().toISOString(),
           collection: await loadCollection(), decks: await listDecks() };
}

export async function importBackup(data, { merge = false } = {}) {
  if (!data || !Array.isArray(data.collection)) throw new Error("Fichier de sauvegarde invalide");
  if (!merge) {
    await saveCollection(data.collection);
    await tx("decks", "readwrite", s => { s.clear(); for (const d of data.decks || []) s.put(d); });
  } else {
    for (const c of data.collection) {
      const cur = await getCard(c.name);
      await setQuantity(c.name, (cur?.quantity || 0) + c.quantity, c);
    }
    await tx("decks", "readwrite", s => { for (const d of data.decks || []) s.put(d); });
  }
  return { cards: data.collection.length, decks: (data.decks || []).length };
}

export async function wipeAll() {
  await saveCollection([]);
  await tx("decks", "readwrite", s => { s.clear(); });
}

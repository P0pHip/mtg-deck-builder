// Cas d'usage « liste d'envies » : stockée localement (IndexedDB, clé « wishlist »), incluse dans les sauvegardes.
import * as core from "../core/index.js";
import { kvGet, kvSet } from "../data/db.js";

const KEY = "wishlist";
const today = () => new Date().toISOString().slice(0, 10);
const listeners = new Set();

/** Prévenu à chaque changement (pour mettre à jour le compteur du bouton ⭐). */
export const onWishlistChange = fn => listeners.add(fn);
async function save(list) {
  await kvSet(KEY, list);
  listeners.forEach(fn => fn(list));
  return list;
}

export const wishlist = async () => (await kvGet(KEY)) || [];

/** Ajoute [{ card, count }] ; `source` : d'où vient l'envie (deck, deck préconstruit…). */
export async function addWishes(items, source = "") {
  return save(core.addWishes(await wishlist(), items, { source, date: today() }));
}

export const setCount = async (name, count) => save(core.setWishCount(await wishlist(), name, count));

/** Retire ce que la collection contient déjà. Retourne le nombre d'envies retirées. */
export async function removeOwned(collection) {
  const owned = Object.fromEntries(collection.map(c => [c.name, c.quantity]));
  const { list, removed } = core.dropOwned(await wishlist(), owned);
  await save(list);
  return removed;
}

export const clear = () => save([]);

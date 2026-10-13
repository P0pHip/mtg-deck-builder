// Cas d'usage « liste d'envies » : stockée localement (IndexedDB, clé « wishlist »), incluse dans les sauvegardes.
import * as core from "../core/index.js";
import { kvGet, kvSet } from "../data/db.js";
import { currentPrices } from "../data/scryfall/index.js";

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

// ------------------------------------------------------------ prix cible et prix à jour
const PRICES_AT = "wishlistPricesAt";
const DAY = 24 * 3600 * 1000;

export const setTarget = async (name, target) => save(core.setWishTarget(await wishlist(), name, target));

/** Date (ms) de la dernière mise à jour des prix, ou null. */
export const pricesAt = async () => (await kvGet(PRICES_AT)) || null;

/**
 * Met à jour les prix des envies (une fois par jour au plus, sauf `force`). Retourne true si les prix ont été relus.
 * Les prix d'une envie ajoutée ou retirée pendant la mise à jour ne sont pas perdus (la liste est relue avant d'enregistrer).
 */
export async function refreshPrices({ force = false, onProgress } = {}) {
  const last = await pricesAt();
  if (!force && last && Date.now() - last < DAY) return false;
  const list = await wishlist();
  if (!list.length) return false;
  const prices = await currentPrices(list, { onProgress });
  await save(core.withWishPrices(await wishlist(), prices));
  await kvSet(PRICES_AT, Date.now());
  return true;
}

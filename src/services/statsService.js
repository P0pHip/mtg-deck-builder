// Cas d'usage « statistiques » : relevé quotidien de la valeur, mise à jour des prix, export.
import * as core from "../core/index.js";
import * as collectionRepo from "../data/collectionRepo.js";
import { kvGet, kvSet } from "../data/db.js";
import { currentPrices } from "../data/scryfall/index.js";

const HISTORY = "value_history", PRICES_AT = "prices_updated_at";
const today = () => new Date().toISOString().slice(0, 10);

/** Historique de valeur : [{ date, value, copies }]. */
export const valueHistory = async () => (await kvGet(HISTORY)) || [];

/** Note la valeur du jour (un relevé par jour, le dernier gagne). */
export async function recordToday(collection) {
  if (!collection.length) return valueHistory();
  const h = core.recordValue(await valueHistory(), collection, today());
  await kvSet(HISTORY, h);
  return h;
}

/** Date de la dernière mise à jour des prix (AAAA-MM-JJ) ou null. */
export const pricesUpdatedAt = async () => (await kvGet(PRICES_AT)) || null;

/** Récupère les prix actuels sur Scryfall et les enregistre. Retourne { updated, changed }. */
export async function refreshPrices({ onProgress } = {}) {
  const col = await collectionRepo.loadCollection();
  const prices = await currentPrices(col, { onProgress });
  const changes = {};
  for (const c of col) if (c.name in prices && prices[c.name] !== c.price_eur) changes[c.name] = { price_eur: prices[c.name] };
  await collectionRepo.updateCards(changes);
  await kvSet(PRICES_AT, today());
  return { updated: Object.keys(prices).length, changed: Object.keys(changes).length };
}

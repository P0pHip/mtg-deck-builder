// Cas d'usage « statistiques » : relevé quotidien de la valeur, mise à jour des prix, export.
import * as core from "../core/index.js";
import * as collectionRepo from "../data/collectionRepo.js";
import { kvGet, kvSet } from "../data/db.js";
import { copyPriceKey, copyPrices, currentPrices } from "../data/scryfall/index.js";

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

/**
 * Récupère les prix actuels sur Scryfall et les enregistre : prix de la carte, et prix de chaque exemplaire
 * (son impression, foil compris). Retourne { updated, changed } (cartes dont un prix a changé).
 */
export async function refreshPrices({ onProgress } = {}) {
  const col = await collectionRepo.loadCollection();
  const half = f => (n, total) => onProgress?.(f(n, total), total * 2);
  const prices = await currentPrices(col, { onProgress: half(n => n) });
  const byCopy = await copyPrices(col, { onProgress: half((n, total) => total + n) });
  const changes = {};
  for (const c of col) {
    const fields = {};
    if (c.name in prices && prices[c.name] !== c.price_eur) fields.price_eur = prices[c.name];
    const copies = c.copies.map(cp => {
      const p = byCopy.get(copyPriceKey(c.name, cp));
      return p ? { ...cp, price_eur: p.eur ?? cp.price_eur, price_foil: p.foil ?? cp.price_foil } : cp;
    });
    if (JSON.stringify(copies) !== JSON.stringify(c.copies)) fields.copies = copies;
    if (Object.keys(fields).length) changes[c.name] = fields;
  }
  await collectionRepo.updateCards(changes);
  await kvSet(PRICES_AT, today());
  return { updated: Object.keys(prices).length, changed: Object.keys(changes).length };
}

// Cas d'usage « statistiques » : relevé quotidien de la valeur, mise à jour des prix, export.
import * as core from "../core/index.js";
import * as collectionRepo from "../data/collectionRepo.js";
import { kvGet, kvSet } from "../data/db.js";
import { copyPriceKey, copyPrices, currentPrices, resolveDeckLines } from "../data/scryfall/index.js";

const HISTORY = "value_history", PRICES_AT = "prices_updated_at";
const today = () => new Date().toISOString().slice(0, 10);

/** Historique de valeur : [{ date, value, copies }]. */
export const valueHistory = async () => (await kvGet(HISTORY)) || [];

/** Note la valeur du jour (un relevé par jour, le dernier gagne ; rien n'est réécrit s'il n'a pas changé). */
export async function recordToday(collection) {
  const old = await valueHistory();
  if (!collection.length) return old;
  const h = core.recordValue(old, collection, today());
  const last = h.at(-1), prev = old.find(x => x.date === last.date);
  if (!prev || prev.value !== last.value || prev.copies !== last.copies) await kvSet(HISTORY, h);
  return h;
}

/** Date de la dernière mise à jour des prix (AAAA-MM-JJ) ou null. */
export const pricesUpdatedAt = async () => (await kvGet(PRICES_AT)) || null;

/**
 * Récupère les prix actuels sur Scryfall et les enregistre : prix de chaque exemplaire (son impression, foil compris)
 * et prix de la carte (celui de son édition). Une seule passe sur les impressions ; seules les cartes dont l'édition
 * n'a pas donné de prix sont cherchées à nouveau (par leur seul nom).
 * onProgress(n, total, étape) : étape 1 = impressions, 2 = cartes restantes. Retourne { updated, changed }.
 */
export async function refreshPrices({ onProgress } = {}) {
  const col = await collectionRepo.loadCollection();
  const byCopy = await copyPrices(col, { onProgress: (n, total) => onProgress?.(n, total, 1) });
  // prix de la carte = celui de l'exemplaire de son édition (non foil d'abord)
  const own = c => c.copies.filter(cp => cp.set === c.set).sort((a, b) => a.foil - b.foil)
    .map(cp => byCopy.get(copyPriceKey(c.name, cp))?.eur).find(p => p != null);
  const prices = {};
  for (const c of col) { const p = own(c); if (p != null) prices[c.name] = p; }
  const rest = col.filter(c => !(c.name in prices));
  if (rest.length) Object.assign(prices, await currentPrices(rest, { onProgress: (n, total) => onProgress?.(n, total, 2) }));

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

/** Classeur d'échange reçu par lien (texte « 2 Sol Ring (C21) ») → { items: [{ card, count }], notFound: [noms] }. */
export async function readTradeOffer(text, { lang = "fr", onProgress } = {}) {
  const lines = core.parseDecklist(text).main;
  const cards = await resolveDeckLines(lines, { lang, onProgress });
  const items = [], notFound = [];
  lines.forEach((l, i) => (cards[i] ? items.push({ card: cards[i], count: l.count }) : notFound.push(l.name)));
  return { items, notFound };
}
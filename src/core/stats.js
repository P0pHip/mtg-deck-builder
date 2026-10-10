// Statistiques de la collection, doubles à échanger, historique de valeur et export CSV. Pur.
import { BASIC_NAMES, mainType, r2 } from "./cards.js";

/** Groupe « couleur » d'une carte : W/U/B/R/G, M (multicolore), C (incolore), L (terrain). */
export function colorGroup(c) {
  if ((c.type_line || "").split("//")[0].includes("Land")) return "L";
  const id = c.color_identity || [];
  return !id.length ? "C" : id.length > 1 ? "M" : id[0];
}

const value = c => (c.price_eur || 0) * c.quantity;

/** Somme par clé : [{ key, value, copies, cards }] trié par valeur décroissante. */
function groupBy(collection, keyOf) {
  const m = new Map();
  for (const c of collection) {
    const k = keyOf(c), g = m.get(k) || { key: k, value: 0, copies: 0, cards: 0 };
    g.value += value(c); g.copies += c.quantity; g.cards++;
    m.set(k, g);
  }
  return [...m.values()].map(g => ({ ...g, value: r2(g.value) })).sort((a, b) => b.value - a.value || b.copies - a.copies);
}

/** Vue d'ensemble de la collection. */
export function collectionStats(collection, { top = 10 } = {}) {
  const reserved = collection.reduce((a, c) => a + Math.min(c.quantity, (c.reserved || []).reduce((x, r) => x + r.count, 0)), 0);
  return {
    value: r2(collection.reduce((a, c) => a + value(c), 0)),
    cards: collection.length,
    copies: collection.reduce((a, c) => a + c.quantity, 0),
    reserved,
    priced: collection.filter(c => c.price_eur != null).length,
    byColor: groupBy(collection, colorGroup),
    byType: groupBy(collection, c => mainType(c.type_line)),
    bySet: groupBy(collection, c => c.set || "?"),
    topCards: [...collection].filter(c => c.price_eur).sort((a, b) => b.price_eur - a.price_eur).slice(0, top),
  };
}

/**
 * Doubles à échanger : exemplaires au-delà de `keep`, et libres (pas rangés dans un deck).
 * Les terrains de base sont ignorés. Retourne [{ card, extra, value }] du plus cher au moins cher.
 */
export function tradeables(collection, keep = 4) {
  return collection.filter(c => !BASIC_NAMES.has(c.name)).map(c => {
    const free = c.free ?? c.quantity;
    const extra = Math.min(free, c.quantity - keep);
    return { card: c, extra, value: r2(extra * (c.price_eur || 0)) };
  }).filter(x => x.extra > 0).sort((a, b) => b.value - a.value || b.extra - a.extra);
}

/**
 * Ajoute (ou remplace) le relevé du jour dans l'historique de valeur : [{ date, value, copies }].
 * Gardé trié par date, 400 relevés au plus.
 */
export function recordValue(history, collection, date) {
  const s = collectionStats(collection);
  const out = (history || []).filter(h => h.date !== date);
  out.push({ date, value: s.value, copies: s.copies });
  return out.sort((a, b) => a.date.localeCompare(b.date)).slice(-400);
}

const csvCell = v => {
  const s = String(v ?? "");
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Collection → CSV « Count, Name, Edition, … » (lisible par Moxfield, ManaBox… et par cette appli). */
export function toCSV(cards, qty = c => c.quantity) {
  const head = ["Count", "Name", "Edition", "Set Name", "Price EUR"];
  const rows = cards.map(c => [qty(c), c.name, (c.set || "").toUpperCase(), c.set_name || "", c.price_eur ?? ""].map(csvCell).join(","));
  return [head.join(","), ...rows].join("\n") + "\n";
}

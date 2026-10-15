// Statistiques de la collection, doubles à échanger, historique de valeur et export CSV. Pur.
import { BASIC_NAMES, mainType, r2 } from "./cards.js";
import { cardValue, copiesOf, copyPrice, setsOf } from "./copies.js";

/** Groupe « couleur » d'une carte : W/U/B/R/G, M (multicolore), C (incolore), L (terrain). */
export function colorGroup(c) {
  if ((c.type_line || "").split("//")[0].includes("Land")) return "L";
  const id = c.color_identity || [];
  return !id.length ? "C" : id.length > 1 ? "M" : id[0];
}

// valeur exemplaire par exemplaire (prix de chaque impression, foil compris)
const value = c => cardValue(c);

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

/** Valeur par extension, d'après les exemplaires (une carte peut compter dans plusieurs extensions). */
function bySet(collection) {
  const m = new Map();
  for (const c of collection) {
    for (const cp of copiesOf(c)) {
      const k = cp.set || "?", g = m.get(k) || { key: k, value: 0, copies: 0, cards: new Set() };
      g.value += copyPrice(c, cp) * cp.qty; g.copies += cp.qty; g.cards.add(c.name);
      m.set(k, g);
    }
  }
  return [...m.values()].map(g => ({ ...g, value: r2(g.value), cards: g.cards.size })).sort((a, b) => b.value - a.value || b.copies - a.copies);
}

/** Vue d'ensemble de la collection. */
export function collectionStats(collection, { top = 10 } = {}) {
  const reserved = collection.reduce((a, c) => a + Math.min(c.quantity, (c.reserved || []).filter(r => !r.loan).reduce((x, r) => x + r.count, 0)), 0);
  return {
    value: r2(collection.reduce((a, c) => a + value(c), 0)),
    cards: collection.length,
    copies: collection.reduce((a, c) => a + c.quantity, 0),
    reserved,
    priced: collection.filter(c => c.price_eur != null).length,
    byColor: groupBy(collection, colorGroup),
    byType: groupBy(collection, c => mainType(c.type_line)),
    bySet: bySet(collection),
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
    // les doubles à échanger sont les exemplaires les moins chers (on garde les foils, les éditions rares)
    const unit = Math.min(...copiesOf(c).map(cp => copyPrice(c, cp)), c.price_eur ?? Infinity);
    return { card: c, extra, value: r2(extra * (Number.isFinite(unit) ? unit : 0)) };
  }).filter(x => x.extra > 0).sort((a, b) => b.value - a.value || b.extra - a.extra);
}

/**
 * Ajoute (ou remplace) le relevé du jour dans l'historique de valeur : [{ date, value, copies }].
 * Gardé trié par date, 400 relevés au plus.
 */
export function recordValue(history, collection, date) {
  // seulement la valeur et le nombre d'exemplaires (appelé à chaque rafraîchissement de la collection)
  const value = r2(collection.reduce((a, c) => a + cardValue(c), 0)), copies = collection.reduce((a, c) => a + c.quantity, 0);
  const out = (history || []).filter(h => h.date !== date);
  out.push({ date, value, copies });
  return out.sort((a, b) => a.date.localeCompare(b.date)).slice(-400);
}

const csvCell = v => {
  const s = String(v ?? "");
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Collection complète → CSV, une ligne par exemplaire (format Moxfield : Count, Name, Edition, Condition, Language,
 * Foil, Collector Number), relu par Moxfield, ManaBox… et par cette appli.
 */
export function collectionCSV(collection) {
  const head = ["Count", "Name", "Edition", "Condition", "Language", "Foil", "Collector Number", "Price EUR"];
  const rows = collection.flatMap(c => copiesOf(c).map(cp => [cp.qty, c.name, cp.set.toUpperCase(), cp.condition, cp.lang || "",
    cp.foil ? "foil" : "", cp.number, copyPrice(c, cp) || ""].map(csvCell).join(",")));
  return [head.join(","), ...rows].join("\n") + "\n";
}

/** Cartes → CSV « Count, Name, Edition, … » (liste d'envies, doubles). */
export function toCSV(cards, qty = c => c.quantity) {
  const head = ["Count", "Name", "Edition", "Set Name", "Price EUR"];
  const rows = cards.map(c => [qty(c), c.name, (c.set || "").toUpperCase(), c.set_name || "", c.price_eur ?? ""].map(csvCell).join(","));
  return [head.join(","), ...rows].join("\n") + "\n";
}

// ------------------------------------------------------------ classeur d'échange partagé
/** Doubles → texte à partager (« 2 Sol Ring (C21) »), relu comme une decklist. */
export const tradeText = list => list.map(x => `${x.extra} ${x.card.name}${x.card.set ? ` (${x.card.set.toUpperCase()})` : ""}`).join("\n");

/**
 * Classeur reçu d'un ami ([{ card, count }]) trié pour moi : ce que je cherche (liste d'envies), ce que je n'ai pas,
 * ce que j'ai déjà. Chaque groupe du plus cher au moins cher. `owned` : nom → quantité possédée.
 */
export function sortTradeOffer(items, { wishes = [], owned = {} } = {}) {
  const wish = new Set(wishes.map(w => w.name));
  const out = { wanted: [], missing: [], owned: [] };
  for (const it of items) (wish.has(it.card.name) ? out.wanted : owned[it.card.name] ? out.owned : out.missing).push(it);
  for (const l of Object.values(out)) l.sort((a, b) => (b.card.price_eur || 0) - (a.card.price_eur || 0) || a.card.name.localeCompare(b.card.name));
  return out;
}
// ------------------------------------------------------------ extensions à compléter
const NOT_COLLECTED = new Set(["token", "memorabilia", "promo", "minigame", "alchemy", "vanguard"]);

/**
 * Extensions entamées : { todo: [{ code, have, size, missing, pct }], done: [codes] }. `sets` : Map code → { printed, count, type, digital }.
 * Une carte compte une fois par extension où on en a un exemplaire ; taille = cartes numérotées de l'extension.
 * todo : les plus proches d'être complètes d'abord (au moins `min` cartes possédées, pour ne pas lister chaque carte isolée).
 */
export function setProgress(collection, sets, { min = 3 } = {}) {
  const have = new Map();
  for (const c of collection) for (const code of setsOf(c)) have.set(code, (have.get(code) || 0) + 1);
  const todo = [], done = [];
  for (const [code, n] of have) {
    const s = sets.get(code), size = s?.printed || s?.count || 0;
    if (!size || s.digital || NOT_COLLECTED.has(s.type)) continue;
    if (n >= size) { done.push(code); continue; }
    if (n >= min) todo.push({ code, have: n, size, missing: size - n, pct: n / size });
  }
  return { todo: todo.sort((a, b) => b.pct - a.pct || a.missing - b.missing), done };
}

/** Cartes d'un catalogue d'extension qui manquent : par rareté, coût (un exemplaire de chaque) et déjà vues ailleurs. Pur. */
export function missingSummary(cards, { haveHere = {}, haveAnywhere = {} } = {}) {
  const missing = cards.filter(c => !haveHere[c.name]);
  const byRarity = {};
  for (const c of missing) byRarity[c.rarity] = (byRarity[c.rarity] || 0) + 1;
  return {
    cards: missing, byRarity, cost: r2(missing.reduce((a, c) => a + (c.price_eur || 0), 0)),
    noPrice: missing.filter(c => c.price_eur == null).length, elsewhere: missing.filter(c => haveAnywhere[c.name]).length,
  };
}
// Combos d'un deck (données de Commander Spellbook, voir data/spellbook.js). Pur.
import { commandZone } from "./partners.js";

const keys = n => [n.toLowerCase(), n.split(" // ")[0].toLowerCase()];

/**
 * Range les combos selon le deck tel qu'il est maintenant (il a pu changer depuis la recherche) :
 *   complete : toutes les cartes sont dans le deck ;
 *   almost   : il en manque une, avec `missing` (son nom) et `owned` (tu l'as en réserve dans ta collection).
 * `owned(nom)` → nombre d'exemplaires libres ; `format` : les combos interdits dans ce format sont écartés.
 * Les plus joués d'abord ; pour ceux qu'il faut compléter, d'abord ceux que ta collection permet de finir.
 */
export function classifyCombos(variants, deck, { owned = () => 0, format = null } = {}) {
  const names = [...(deck?.cards || []).map(c => c.name), ...commandZone(deck).map(c => c.name)];
  const inDeck = new Set(names.flatMap(keys));
  const has = n => keys(n).some(k => inDeck.has(k));
  const complete = [], almost = [];
  for (const v of variants || []) {
    if (format && v.legal && v.legal[format] === false) continue;
    const missing = v.cards.filter(n => !has(n));
    if (!missing.length) complete.push(v);
    else if (missing.length === 1) almost.push({ ...v, missing: missing[0], owned: owned(missing[0]) > 0 });
  }
  const byPop = (a, b) => b.popularity - a.popularity;
  return { complete: complete.sort(byPop), almost: almost.sort((a, b) => b.owned - a.owned || byPop(a, b)) };
}

/** Lien vers la fiche du combo sur Commander Spellbook. */
export const comboUrl = id => `https://commanderspellbook.com/combo/${encodeURIComponent(id)}/`;

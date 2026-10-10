// Améliorer un deck avec sa collection : remplacer les cartes les plus faibles par de meilleures cartes libres
// du même rôle (ramp, pioche, removal, créatures…). Pur ; l'application passe ensuite par applyChanges (validation).
import { BASIC_NAMES, category, quality, subtypes, synergy } from "./cards.js";
import { legalPool } from "./editing.js";

/** Force d'une carte dans ce deck : popularité + synergies avec le commandant (thèmes, tribus). */
function strength(card, deck) {
  const cmd = deck.commander;
  const tribes = new Set(deck.tribes || (cmd ? [...subtypes(cmd)].filter(t => t !== "Human" && t !== "Legendary") : []));
  return quality(card) + synergy(card, deck.themes || [], tribes);
}

/**
 * Échanges proposés : [{ out, in, count, gain }] du plus utile au moins utile.
 * pool : cartes disponibles (libres) ; les terrains et les cartes du souhait (★) ne sont pas touchés.
 * known : cartes complètes (la collection) ; les lignes d'un deck enregistré n'ont pas le rang EDHREC,
 * il faut la carte complète pour juger leur force.
 * minGain : écart de force minimal pour qu'un échange vaille la peine.
 */
export function upgradeSuggestions(deck, pool, { known = [], max = 12, minGain = 0.12 } = {}) {
  const full = new Map([...known, ...pool].map(c => [c.name, c]));
  const inDeck = new Set(deck.cards.map(c => c.name));
  if (deck.commander) inDeck.add(deck.commander.name);
  const cap = deck.format === "commander" ? 1 : 4;
  const candidates = legalPool(pool, deck)
    .filter(c => !inDeck.has(c.name) && c.quantity > 0 && category(c) !== "land")
    .map(c => ({ card: c, cat: category(c), s: strength(c, deck) }))
    .sort((a, b) => b.s - a.s);
  const weak = deck.cards
    .filter(e => e.category !== "land" && e.category !== "commander" && !BASIC_NAMES.has(e.name) && !e.wish)
    .map(e => ({ e, s: strength(full.get(e.name) || e, deck) }))
    .sort((a, b) => a.s - b.s);

  const used = new Set(), out = [];
  for (const w of weak) {
    if (out.length >= max) break;
    // même rôle (ramp contre ramp…) ; une carte « autre » peut être remplacée par n'importe quel sort non-créature
    const fits = c => c.cat === w.e.category || (w.e.category === "other" && c.cat !== "creature");
    const pick = candidates.find(c => !used.has(c.card.name) && fits(c) && c.s - w.s >= minGain);
    if (!pick) continue;
    used.add(pick.card.name);
    const count = Math.min(w.e.count, pick.card.quantity, cap);
    out.push({ out: w.e, in: pick.card, count, gain: Math.round((pick.s - w.s) * 100) / 100 });
  }
  return out.sort((a, b) => b.gain - a.gain);
}

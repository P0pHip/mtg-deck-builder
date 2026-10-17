// Améliorer un deck avec sa collection : remplacer les cartes les plus faibles par de meilleures cartes libres
// du même rôle (ramp, pioche, removal, créatures…). Pur ; l'application passe ensuite par applyChanges (validation).
import { BASIC_NAMES, category, quality, subtypes, synergy } from "./cards.js";
import { edhBonus } from "./builder.js";
import { applyChanges, legalPool } from "./editing.js";
import { commandZone } from "./partners.js";
import { swapWithSide } from "./sideboard.js";

/** Force d'une carte dans ce deck : popularité + synergies avec le commandant (thèmes, tribus, et EDHREC si fourni). */
function strength(card, deck, edh = null) {
  const cmd = deck.commander;
  const tribes = new Set(deck.tribes || (cmd ? [...subtypes(cmd)].filter(t => t !== "Human" && t !== "Legendary") : []));
  return quality(card) + synergy(card, deck.themes || [], tribes) + edhBonus(card, edh);
}

/**
 * Échanges proposés : [{ out, in, count, gain, side }] du plus utile au moins utile.
 * side : exemplaires de la carte proposée pris dans la réserve du deck (la carte retirée y prend alors leur place).
 * pool : cartes disponibles (libres) ; les terrains et les cartes du souhait (★) ne sont pas touchés.
 * known : cartes complètes (la collection) ; les lignes d'un deck enregistré n'ont pas le rang EDHREC,
 * il faut la carte complète pour juger leur force.
 * minGain : écart de force minimal pour qu'un échange vaille la peine.
 */
export function upgradeSuggestions(deck, pool, { known = [], edh = null, max = 12, minGain = 0.12 } = {}) {
  const full = new Map([...known, ...pool].map(c => [c.name, c]));
  const inDeck = new Set(deck.cards.map(c => c.name));
  for (const z of commandZone(deck)) inDeck.add(z.name);
  const cap = deck.format === "commander" ? 1 : 4;
  const candidates = legalPool(pool, deck)
    .filter(c => !inDeck.has(c.name) && c.quantity > 0 && category(c) !== "land")
    .map(c => ({ card: c, cat: category(c), s: strength(c, deck, edh) }))
    .sort((a, b) => b.s - a.s);
  const weak = deck.cards
    .filter(e => e.category !== "land" && e.category !== "commander" && !BASIC_NAMES.has(e.name) && !e.wish)
    .map(e => ({ e, s: strength(full.get(e.name) || e, deck, edh) }))
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
    const side = Math.min(count, (deck.side || []).find(s => s.name === pick.card.name)?.count || 0);
    out.push({ out: w.e, in: pick.card, count, gain: Math.round((pick.s - w.s) * 100) / 100, side });
  }
  return out.sort((a, b) => b.gain - a.gain);
}

/**
 * Applique les échanges choisis, un par un et chacun en entier (jamais une carte retirée sans sa remplaçante) :
 * les exemplaires pris dans la réserve sont échangés avec elle (voir swapWithSide), les autres viennent de la collection.
 * Retourne { deck, log }.
 */
export function applyUpgrades(deck, pool, swaps) {
  const log = [];
  for (const u of swaps) {
    const side = Math.min(u.side || 0, u.count);
    let d = deck, part = [];
    if (side) {
      const r = swapWithSide(d, pool, u.out.name, u.in.name, side);
      d = r.deck; part.push(...r.log);
    }
    const rest = u.count - side;
    if (rest > 0 && part.every(l => l.ok)) {
      const r = applyChanges(d, pool, [{ name: u.out.name, count: rest }], [{ name: u.in.name, count: rest }]);
      d = r.deck; part.push(...r.log);
    }
    if (part.every(l => l.ok)) deck = d;
    log.push(...(part.every(l => l.ok) ? part : part.filter(l => !l.ok)));
  }
  return { deck, log };
}

/**
 * Améliorer un deck en achetant des cartes, dans la limite de `budget` euros : [{ out, in, count, gain, cost }] et `spent`.
 * market : cartes à acheter possibles (les plus jouées du format et des couleurs) ; celles déjà dans la collection
 * (`known`) sont écartées (elles passent par « Améliorer avec ma collection »).
 * Les cartes les plus faibles sont remplacées d'abord, chacune par la meilleure carte du même rôle qui tient dans le budget restant.
 */
export function budgetSuggestions(deck, market, { budget, known = [], edh = null, max = 12, minGain = 0.12 } = {}) {
  const full = new Map(known.map(c => [c.name, c]));
  const skip = new Set([...deck.cards.map(c => c.name), ...known.map(c => c.name), ...commandZone(deck).map(c => c.name)]);
  const cap = deck.format === "commander" ? 1 : 4;
  const candidates = legalPool(market.map(c => ({ ...c, quantity: cap })), deck)
    .filter(c => !skip.has(c.name) && c.price_eur != null && category(c) !== "land")
    .map(c => ({ card: c, cat: category(c), s: strength(c, deck, edh) }))
    .sort((a, b) => b.s - a.s);
  const weak = deck.cards
    .filter(e => e.category !== "land" && e.category !== "commander" && !BASIC_NAMES.has(e.name) && !e.wish)
    .map(e => ({ e, s: strength(full.get(e.name) || e, deck, edh) }))
    .sort((a, b) => a.s - b.s);

  let left = budget;
  const used = new Set(), out = [];
  for (const w of weak) {
    if (out.length >= max || left <= 0) break;
    const count = Math.min(w.e.count, cap);
    const fits = c => c.cat === w.e.category || (w.e.category === "other" && c.cat !== "creature");
    const pick = candidates.find(c => !used.has(c.card.name) && fits(c) && c.s - w.s >= minGain && c.card.price_eur * count <= left);
    if (!pick) continue;
    used.add(pick.card.name);
    const cost = Math.round(pick.card.price_eur * count * 100) / 100;
    left -= cost;
    out.push({ out: w.e, in: pick.card, count, gain: Math.round((pick.s - w.s) * 100) / 100, cost });
  }
  return { swaps: out.sort((a, b) => b.gain - a.gain), spent: Math.round((budget - left) * 100) / 100 };
}
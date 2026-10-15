// Réserve (sideboard) des decks à 60 cartes : 15 cartes au plus, 4 exemplaires au total avec le deck, légales. Pur.
// La réserve est `deck.side` (mêmes entrées que `deck.cards`) ; elle n'entre ni dans la courbe ni dans la main de départ.
import { BASIC_NAMES, category, inIdentity, quality } from "./cards.js";
import { entry } from "./builder.js";
import { applyChanges } from "./editing.js";

export const SIDE_MAX = 15;
export const hasSideboard = deck => !!deck && deck.format !== "commander";
export const sideTotal = deck => (deck?.side || []).reduce((a, c) => a + c.count, 0);
const inMain = (deck, name) => deck.cards.find(c => c.name === name)?.count || 0;
const inSide = (deck, name) => (deck.side || []).find(c => c.name === name)?.count || 0;

/**
 * Cartes ajoutables à la réserve, avec `free` = exemplaires encore utilisables : possédés et libres (`pool`),
 * moins ceux du deck et de la réserve, sans dépasser 4 au total (terrains de base : seulement ce qu'on possède).
 */
export function sidePool(deck, pool) {
  return pool.filter(c => c.legalities?.[deck.format] === "legal")
    .map(c => {
      const used = inMain(deck, c.name) + inSide(deck, c.name);
      const cap = BASIC_NAMES.has(c.name) ? c.quantity : Math.min(c.quantity, 4);
      return { ...c, free: cap - used };
    })
    .filter(c => c.free > 0);
}

const withSide = (deck, side) => ({ ...deck, side: side.filter(c => c.count > 0) });

/** Ajouts / retraits dans la réserve, validés (possédée, libre, légale, 4 au total, 15 au plus). Retourne { deck, log }. */
export function editSide(deck, pool, { add = [], remove = [] } = {}) {
  let side = (deck.side || []).map(c => ({ ...c }));
  const log = [];
  for (const r of remove) {
    const e = side.find(c => c.name === r.name);
    if (!e) { log.push({ ok: false, k: "notInSide", name: r.name }); continue; }
    const n = Math.min(e.count, Math.max(1, r.count ?? 1));
    e.count -= n;
    log.push({ ok: true, sign: "−", n, name: e.name });
  }
  side = side.filter(c => c.count > 0);
  for (const a of add) {
    const c = sidePool(withSide(deck, side), pool).find(x => x.name === a.name);
    if (!c) { log.push({ ok: false, k: pool.some(x => x.name === a.name) ? "atMax" : "notAvailable", name: a.name }); continue; }
    const room = SIDE_MAX - side.reduce((s, x) => s + x.count, 0);
    const n = Math.min(Math.max(1, a.count ?? 1), c.free, room);
    if (n <= 0) { log.push({ ok: false, k: "sideFull", name: a.name }); continue; }
    const e = side.find(x => x.name === c.name);
    if (e) e.count += n; else side.push(entry(c, n, quality(c)));
    log.push({ ok: true, sign: "+", n, name: c.name });
  }
  return { deck: withSide(deck, side), log };
}

/** Passe `n` exemplaires du deck vers la réserve (refusé si la réserve est pleine). */
export function moveToSide(deck, pool, name, n = 1) {
  if (sideTotal(deck) + n > SIDE_MAX) return { deck, log: [{ ok: false, k: "sideFull", name }] };
  const out = applyChanges(deck, pool, [{ name, count: n }], []);
  if (!out.log[0]?.ok) return { deck, log: out.log };
  const moved = deck.cards.find(c => c.name === name);
  const side = (deck.side || []).map(c => ({ ...c }));
  const e = side.find(c => c.name === name);
  if (e) e.count += n; else side.push({ ...moved, count: n });
  return { deck: withSide(out.deck, side), log: [{ ok: true, sign: "↓", n, name }] };
}

/** Repasse `n` exemplaires de la réserve dans le deck (ajout validé comme les autres : couleurs, légalité…). */
export function moveToMain(deck, pool, name, n = 1) {
  const side = (deck.side || []).map(c => ({ ...c }));
  const e = side.find(c => c.name === name);
  if (!e) return { deck, log: [{ ok: false, k: "notInSide", name }] };
  e.count -= n;
  const freed = withSide(deck, side);
  const out = applyChanges(freed, pool, [], [{ name, count: n }]);
  if (!out.log[0]?.ok) return { deck, log: out.log }; // refusé : la réserve reste comme avant
  return { deck: { ...out.deck, side: freed.side }, log: [{ ok: true, sign: "↑", n, name }] };
}

// cartes de réserve : réponses aux stratégies adverses courantes (poids, motif dans le texte Oracle)
const ANSWERS = [
  ["counter", 1, /counter target (spell|noncreature|instant|creature)/i],
  ["artifact", 1, /(destroy|exile) (target|all|each) (artifacts?|enchantments?|artifact or enchantment|nonland permanent)/i],
  // cimetières adverses (Rest in Peace, Relic, Tormod's Crypt, Leyline of the Void…), pas « exile de ton cimetière » (Delve, Snapcaster)
  ["graveyard", 0.9, /exile (all cards from |all |each opponent's |target player's )?(target player's |an opponent's )?graveyards?\b|exile target card from a graveyard|would be put into (an opponent's|a) graveyard from anywhere, exile it instead|exiles? (a|target) card from (their|a|an opponent's) graveyard/i],
  ["wipe", 0.9, /destroy all creatures|deals? \d+ damage to each creature|all creatures get -/i],
  ["removal", 0.75, null], // rôle « removal » du moteur
  ["life", 0.3, /you gain \d+ life/i],
];

/** Ce contre quoi une carte sert en réserve (« counter », « artifact »…) et son poids, ou null. */
export function sideRole(c) {
  for (const [k, w, rx] of ANSWERS) {
    if (rx ? rx.test(c.oracle_text || "") : category(c) === k) return { k, w };
  }
  return null;
}

/**
 * Réserve proposée avec les cartes libres : des réponses variées (contresorts, destruction d'artefacts / enchantements,
 * cimetières, balais, removal), dans les couleurs du deck, 2 à 3 exemplaires chacune, 15 cartes au plus.
 */
export function suggestSideboard(deck, pool, size = SIDE_MAX) {
  const base = withSide(deck, []);
  const candidates = sidePool(base, pool)
    .filter(c => !BASIC_NAMES.has(c.name) && inIdentity(c, deck.identity) && category(c) !== "land")
    .map(c => ({ c, role: sideRole(c) }))
    .filter(x => x.role)
    .map(x => ({ ...x, s: x.role.w + quality(x.c) * 0.6 }))
    .sort((a, b) => b.s - a.s);
  const side = [], perRole = {};
  for (const { c, role } of candidates) {
    const room = size - side.reduce((a, x) => a + x.count, 0);
    if (room <= 0) break;
    if ((perRole[role.k] || 0) >= 5) continue; // de la variété : pas 15 contresorts
    const n = Math.min(c.free, 3, room, 5 - (perRole[role.k] || 0));
    if (n < 1) continue;
    side.push({ ...entry(c, n, quality(c)), side_role: role.k });
    perRole[role.k] = (perRole[role.k] || 0) + n;
  }
  return withSide(deck, side);
}

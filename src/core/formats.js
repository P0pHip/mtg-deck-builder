// Formats des decks enregistrés : cartes qui ne sont plus légales (rotation Standard, carte bannie) et format où ranger le deck. Pur.
import { BASIC_NAMES } from "./cards.js";
import { commandZone } from "./partners.js";

// formats « en escalier » : un deck légal dans l'un l'est dans les suivants (presque toujours) ; Commander et Pauper à part
const LADDER = ["standard", "pioneer", "modern", "legacy", "vintage"];
const ok = s => s === "legal" || s === "restricted";

/**
 * `legal` : nom → légalités Scryfall. null si tout est en ordre ; sinon { illegal: [{ name, status }], newFormat }
 * (status : "banned" | "not_legal" ; newFormat : premier format suivant de l'escalier où tout le deck est légal,
 * ou null — Commander, Pauper, ou rien ne convient). Les cartes inconnues de `legal` ne sont pas jugées.
 */
export function formatCheck(deck, legal) {
  const names = [...new Set([...deck.cards.map(c => c.name), ...commandZone(deck).map(c => c.name)])].filter(n => !BASIC_NAMES.has(n) && legal[n]);
  const illegal = names.filter(n => !ok(legal[n][deck.format])).map(n => ({ name: n, status: legal[n][deck.format] === "banned" ? "banned" : "not_legal" }));
  if (!illegal.length) return null;
  const from = LADDER.indexOf(deck.format);
  const newFormat = from < 0 ? null : LADDER.slice(from + 1).find(f => names.every(n => ok(legal[n][f]))) || null;
  return { illegal, newFormat };
}
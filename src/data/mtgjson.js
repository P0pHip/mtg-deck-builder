// Decks préconstruits vendus par Wizards (Commander, decks de démarrage…), d'après les listes ouvertes de MTGJSON.
// MTGJSON autorise les appels depuis le navigateur ; chaque carte y porte son identifiant Scryfall (impression exacte).
import { kvGet, kvSet } from "./db.js";
import { getJSON } from "./scryfall/client.js";

export const MTGJSON = "https://mtgjson.com/api/v5";
const KEY = "mtgjson_decklist";
const TTL = 7 * 24 * 3600 * 1000;

/** Types de produits MTGJSON → catégorie affichée (les autres types — Secret Lair, MTGO, Arena… — sont ignorés). */
export const PRECON_KINDS = {
  "Commander Deck": "commander",
  "Starter Deck": "starter", "Starter Kit": "starter", "Welcome Deck": "starter", "Planeswalker Deck": "starter",
  "Intro Pack": "starter", "Theme Deck": "starter", "Game Night Deck": "starter", "Arena Starter Kit": "starter",
  "Spellslinger Starter Kit": "starter",
  "Challenger Deck": "other", "Pioneer Challenger Deck": "other", "Duel Deck": "other", "Event Deck": "other",
  "Brawl Deck": "other", "Guild Kit": "other", "Clash Pack": "other", "Planechase Deck": "other",
  "Archenemy Deck": "other", "Premium Deck": "other", "Enhanced Deck": "other", "Advanced Deck": "other",
};

/** Liste MTGJSON brute → decks papier connus, les plus récents d'abord. Pur. */
export function parseDeckList(json, today = new Date().toISOString().slice(0, 10)) {
  return (json?.data || [])
    .filter(d => PRECON_KINDS[d.type] && (d.releaseDate || "") <= today)
    .map(d => ({ file: d.fileName, name: d.name, set: (d.code || "").toLowerCase(), released: d.releaseDate || "", type: d.type, kind: PRECON_KINDS[d.type] }))
    .sort((a, b) => b.released.localeCompare(a.released) || a.name.localeCompare(b.name));
}

/** Tous les decks préconstruits (gardés 7 jours). */
export async function preconList() {
  const hit = await kvGet(KEY);
  if (hit && Date.now() - hit.at < TTL) return hit.decks;
  try {
    const decks = parseDeckList(await getJSON(`${MTGJSON}/DeckList.json`));
    await kvSet(KEY, { at: Date.now(), decks });
    return decks;
  } catch (e) {
    if (hit) return hit.decks; // hors ligne : ancienne liste
    throw e;
  }
}

/** Fichier de deck MTGJSON → { name, set, type, commander, main, side } (cartes { id, name, count }). Pur. */
export function parseDeck(json) {
  const d = json?.data;
  if (!d) return null;
  const cards = list => (list || []).filter(c => c.identifiers?.scryfallId)
    .map(c => ({ id: c.identifiers.scryfallId, name: c.name, count: c.count || 1 }));
  return {
    name: d.name, set: (d.code || "").toLowerCase(), type: d.type, released: d.releaseDate || "",
    commander: cards(d.commander), main: cards(d.mainBoard), side: cards(d.sideBoard),
  };
}

/** Contenu d'un deck préconstruit (fichier MTGJSON). */
export async function preconDeck(file) {
  const deck = parseDeck(await getJSON(`${MTGJSON}/decks/${encodeURIComponent(file)}.json`));
  if (!deck) throw new Error("not-found");
  return deck;
}

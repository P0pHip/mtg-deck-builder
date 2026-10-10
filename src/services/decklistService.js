// Cas d'usage « importer une decklist » : texte collé → cartes reconnues → deck enregistré (avec ce qu'il manque).
import * as core from "../core/index.js";
import * as collectionRepo from "../data/collectionRepo.js";
import * as decksRepo from "../data/decksRepo.js";
import { resolveDeckLines } from "../data/scryfall/index.js";

/**
 * Texte d'une decklist → { name, commander, cards: [{ card, count, board }], notFound: [noms], ignored: [lignes] }.
 * board : "commander" | "main" | "side".
 */
export async function importDecklist(text, { lang = "fr", onProgress } = {}) {
  const parsed = core.parseDecklist(text);
  const lines = [...parsed.commander.map(l => ({ ...l, board: "commander" })), ...parsed.main.map(l => ({ ...l, board: "main" })),
    ...parsed.side.map(l => ({ ...l, board: "side" }))];
  if (!lines.length) throw new Error("no-cards");
  const found = await resolveDeckLines(lines, { lang, onProgress });
  const cards = [], notFound = [];
  lines.forEach((l, i) => {
    const card = found[i];
    if (!card) { notFound.push(l.name); return; }
    const same = cards.find(x => x.card.name === card.name && x.board === l.board);
    if (same) same.count += l.count; else cards.push({ card, count: l.count, board: l.board });
  });
  const commander = cards.find(x => x.board === "commander")?.card || null;
  return { name: parsed.name, commander, cards, notFound, ignored: parsed.ignored };
}

/** Commandants possibles : créatures légendaires (ou cartes « peut être votre commandant ») hors réserve. */
export const commanderChoices = imp => imp.cards.filter(x => x.board !== "side" && x.count === 1
  && (/Legendary.*Creature/.test(core.front(x.card.type_line)) || /can be your commander/i.test(x.card.oracle_text || "")));

/** Change le commandant (null = aucun) : l'ancien retourne dans le deck. Modifie `imp`. */
export function setCommander(imp, name) {
  for (const x of imp.cards) if (x.board === "commander") x.board = "main";
  const pick = name ? imp.cards.find(x => x.card.name === name && x.board === "main") : null;
  if (pick) pick.board = "commander";
  imp.commander = pick?.card || null;
  return imp;
}

/** Lignes du deck principal (commandant compris, sans la réserve) au format [{ card, count }]. */
export const mainList = imp => imp.cards.filter(x => x.board !== "side").map(x => ({ card: x.card, count: x.count }));

/**
 * Exemplaires disponibles pour ce deck : cartes possédées moins celles rangées dans d'autres decks.
 * Retourne nom → nombre (les terrains de base ne comptent pas).
 */
export async function freeCopies() {
  const col = await collectionRepo.loadCollection();
  return Object.fromEntries(decksRepo.availableSync(col, await decksRepo.reservations()).map(c => [c.name, c.quantity]));
}

/**
 * Enregistre le deck importé dans « Mes decks ». Les cartes absentes sont marquées « à acheter ».
 * `complete` : « j'ai déjà ces cartes » → la collection est d'abord complétée avec ce qui manque.
 * Retourne { deck: entrée enregistrée, added: exemplaires ajoutés à la collection }.
 */
export async function saveImported(imp, { name, format = null, complete = false } = {}) {
  const list = mainList(imp);
  let added = 0;
  if (complete) {
    const free = await freeCopies(), need = {};
    for (const { card, count } of list) if (!core.BASIC_NAMES.has(card.name)) need[card.name] = { card, n: (need[card.name]?.n || 0) + count };
    for (const { card, n } of Object.values(need)) {
      const missing = n - (free[card.name] || 0);
      if (missing <= 0) continue;
      const cur = await collectionRepo.getCard(card.name);
      await collectionRepo.setQuantity(card.name, (cur?.quantity || 0) + missing, card);
      added += missing;
    }
  }
  const deck = core.deckFromList(list, { commander: imp.commander, format, owned: await freeCopies() });
  return { deck: await decksRepo.saveDeck(name || imp.name || imp.commander?.name || "Deck", deck), added };
}

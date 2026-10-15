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
  const zone = cards.filter(x => x.board === "commander").map(x => x.card);
  const commander = zone[0] || null;
  // deux commandants dans la section (Partner, Background…) : le second devient le partenaire s'ils vont ensemble
  const partner = zone.find(c => commander && core.canPair(commander, c)) || null;
  for (const x of cards) if (x.board === "commander" && x.card !== commander && x.card !== partner) x.board = "main";
  return { name: parsed.name, commander, partner, cards, notFound, ignored: parsed.ignored };
}

/** Partenaires possibles du commandant choisi, parmi les cartes de la liste. */
export const partnerChoices = imp => (imp.commander ? imp.cards.filter(x => x.board !== "side" && x.count === 1 && core.canPair(imp.commander, x.card)) : []);

/** Change le partenaire (null = aucun) : l'ancien retourne dans le deck. Modifie `imp`. */
export function setPartner(imp, name) {
  for (const x of imp.cards) if (x.board === "commander" && x.card !== imp.commander) x.board = "main";
  const pick = name ? imp.cards.find(x => x.card.name === name && x.board === "main" && core.canPair(imp.commander, x.card)) : null;
  if (pick) pick.board = "commander";
  imp.partner = pick?.card || null;
  return imp;
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
  imp.partner = null; // nouveau commandant : le partenaire est à choisir de nouveau
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
    const basicsToo = core.tracksBasics(await collectionRepo.loadCollection());
    for (const { card, count } of list) if (basicsToo || !core.BASIC_NAMES.has(card.name)) need[card.name] = { card, n: (need[card.name]?.n || 0) + count };
    for (const { card, n } of Object.values(need)) {
      const missing = n - (free[card.name] || 0);
      if (missing <= 0) continue;
      const cur = await collectionRepo.getCard(card.name);
      await collectionRepo.setQuantity(card.name, (cur?.quantity || 0) + missing, card);
      added += missing;
    }
  }
  const free = await freeCopies();
  let deck = core.deckFromList(list, { commander: imp.commander, partner: imp.partner, format, owned: free });
  // terrains de base : comptés comme le reste si la collection en enregistre (ce qui manque est « à acheter »)
  if (core.tracksBasics(await collectionRepo.loadCollection())) deck = core.withBasicStock(deck, free);
  return { deck: await decksRepo.saveDeck(name || imp.name || imp.commander?.name || "Deck", deck), added };
}

// Cas d'usage « deck préconstruit » : charger un deck vendu par Wizards, l'ajouter à la collection (et à « Mes decks »).
import * as core from "../core/index.js";
import * as collectionRepo from "../data/collectionRepo.js";
import { kvGet, kvSet } from "../data/db.js";
import * as decksRepo from "../data/decksRepo.js";
import { preconDeck } from "../data/mtgjson.js";
import { cardsByIds } from "../data/scryfall/index.js";

const ADDED_KEY = "precons_added";

/**
 * Deck préconstruit complet : { name, set, type, commander: carte | null, cards: [{ card, count, board }] }.
 * board : "commander" | "main" | "side". Les cartes portent l'impression exacte du deck.
 */
export async function loadPrecon(file, { onProgress } = {}) {
  const deck = await preconDeck(file);
  const all = [...deck.commander.map(c => ({ ...c, board: "commander" })), ...deck.main.map(c => ({ ...c, board: "main" })),
    ...deck.side.map(c => ({ ...c, board: "side" }))];
  const byId = await cardsByIds(all.map(c => c.id), { onProgress });
  const cards = [];
  for (const c of all) {
    const card = byId.get(c.id);
    if (!card) continue;
    // même carte en plusieurs impressions dans le même deck : une seule ligne
    const same = cards.find(x => x.card.name === card.name && x.board === c.board);
    if (same) same.count += c.count; else cards.push({ card, count: c.count, board: c.board });
  }
  const commander = cards.find(x => x.board === "commander")?.card || null;
  return { file, name: deck.name, set: deck.set, type: deck.type, released: deck.released, commander, cards };
}

/** Lignes du deck à ajouter selon les options (terrains de base et réserve facultatifs). Pur. */
export function preconLines(precon, { basics = false, side = false } = {}) {
  return precon.cards.filter(x => (side || x.board !== "side") && (basics || !core.BASIC_NAMES.has(x.card.name)));
}

/**
 * Ajoute les cartes du deck à la collection. `saveDeck` : l'enregistre aussi dans « Mes decks » (ses cartes y sont réservées).
 * Retourne { cards, copies, deck } (deck = entrée enregistrée ou null).
 */
export async function addPrecon(precon, { basics = false, side = false, saveDeck = false } = {}) {
  const lines = preconLines(precon, { basics, side });
  const totals = new Map();
  for (const x of lines) {
    const t = totals.get(x.card.name) || { card: x.card, count: 0 };
    t.count += x.count;
    totals.set(x.card.name, t);
  }
  for (const { card, count } of totals.values()) {
    const cur = await collectionRepo.getCard(card.name);
    await collectionRepo.setQuantity(card.name, (cur?.quantity || 0) + count, card);
  }
  let deck = null;
  if (saveDeck) {
    // le deck garde tout (terrains de base compris), sans la réserve
    const list = precon.cards.filter(x => x.board !== "side").map(x => ({ card: x.card, count: x.count }));
    deck = await decksRepo.saveDeck(precon.name, core.deckFromList(list, { commander: precon.commander }));
  }
  const added = (await kvGet(ADDED_KEY)) || {};
  added[precon.file] = new Date().toISOString().slice(0, 10);
  await kvSet(ADDED_KEY, added);
  return { cards: totals.size, copies: [...totals.values()].reduce((a, t) => a + t.count, 0), deck };
}

/** Decks déjà ajoutés : { fichier: date }. */
export const addedPrecons = async () => (await kvGet(ADDED_KEY)) || {};

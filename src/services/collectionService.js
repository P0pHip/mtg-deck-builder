// Cas d'usage autour de la collection : import de fichier, ajout manuel, +/−.
import * as core from "../core/index.js";
import * as collectionRepo from "../data/collectionRepo.js";
import * as decksRepo from "../data/decksRepo.js";
import { enrich, frenchFor, parseCollection } from "../data/scryfall/index.js";

/** Collection + réservations : chaque carte reçoit `reserved` (decks) et `free` (exemplaires libres). */
export async function loadWithReservations() {
  const collection = await collectionRepo.loadCollection();
  const res = await decksRepo.reservations();
  for (const c of collection) {
    c.reserved = res[c.name] || [];
    c.free = c.quantity - c.reserved.reduce((a, r) => a + r.count, 0);
  }
  return collection;
}

/** Importe un fichier CSV/JSON. `merge` = ajoute à la collection existante au lieu de la remplacer. */
export async function importFile(filename, text, { merge = false, onProgress = () => {} } = {}) {
  const entries = parseCollection(filename, text);
  if (!entries.length) throw new Error("no-cards");
  const { collection, notFound } = await enrich(entries, onProgress);
  // une ligne par exemplaire (extension, langue, foil, état) → une carte par nom, avec ses exemplaires
  const cards = new Map();
  for (const c of collection) {
    const copy = { set: c.set, set_name: c.set_name, number: c.number, lang: c.lang, foil: c.foil, condition: c.condition, qty: c.quantity,
      price_eur: c.set === c.card_set ? c.price_eur : null }; // prix connu seulement pour l'impression récupérée
    const cur = cards.get(c.name);
    if (cur) cur.copies.push(copy); else cards.set(c.name, { card: core.cardData(c), copies: [copy] });
  }
  if (merge) {
    for (const { card, copies } of cards.values()) await collectionRepo.addCopies(card, copies);
  } else {
    await collectionRepo.saveCollection([...cards.values()].map(({ card, copies }) => core.addCopies(core.withCopies(card, []), copies)));
  }
  return { cards: cards.size, copies: collection.reduce((a, c) => a + c.quantity, 0), notFound };
}

/**
 * Ajoute `qty` exemplaires d'une carte trouvée par la recherche Scryfall. Retourne la quantité totale.
 * `known` : la carte déjà renvoyée par la recherche ; si l'extension choisie est la sienne, aucun nouvel appel n'est fait.
 * `foil`, `lang` : détails de l'exemplaire ajouté.
 */
export async function addCard(name, qty, set = "", setName = "", known = null, { foil = false, lang = "" } = {}) {
  const sameAsKnown = known && (!set || set === known.set);
  const copy = { set: set || known?.set || "", set_name: setName || (sameAsKnown ? known.set_name : ""), foil, lang, qty,
    price_eur: sameAsKnown ? known.price_eur : null, price_foil: sameAsKnown ? known.price_foil ?? null : null };
  const cur = await collectionRepo.getCard(name);
  if (cur) return collectionRepo.addCopies(cur, [copy]);
  if (sameAsKnown) {
    if (!known.fr) await frenchFor([known]);
    return collectionRepo.addCopies(known, [copy]);
  }
  const { collection } = await enrich([{ name, quantity: qty, set }]);
  if (!collection.length) throw new Error("not-found");
  const card = collection[0];
  return collectionRepo.addCopies(card, [{ ...copy, set: set || card.set, set_name: setName || card.set_name,
    price_eur: (set || card.set) === card.card_set ? card.price_eur : null }]);
}

/** Ajout rapide depuis le catalogue d'une extension (impression exacte, pas d'appel réseau). */
export async function addFromCatalog(card, qty = 1, { foil = false } = {}) {
  return collectionRepo.addCopies(card, [{ set: card.set, set_name: card.set_name, number: card.number || card.collector || "",
    lang: card.lang || "", foil, qty, price_eur: card.price_eur ?? null, price_foil: card.price_foil ?? null }]);
}

/** Retire un exemplaire d'une extension précise (et d'une finition, si `foil` est donné). Retourne la quantité restante. */
export const removeFromSet = (name, set, n = 1, foil = null) =>
  collectionRepo.removeCopies(name, n, c => c.set === set && (foil === null || c.foil === foil));

/** Modifie un exemplaire (langue, foil, état, quantité) ; retourne la carte à jour. */
export const updateCopy = (name, key, changes) => collectionRepo.updateCopy(name, key, changes);

/** Une carte de la collection (avec ses exemplaires), ou null. */
export const getCard = name => collectionRepo.getCard(name);

/** Ajoute un exemplaire précis à une carte possédée (éditeur d'exemplaires). */
export const addCopy = (card, copy) => collectionRepo.addCopies(card, [copy]);

/** +/− sur une carte. Retourne { quantity, reservedOverflow } (exemplaires rangés au-delà du stock). */
export async function changeQuantity(card, delta) {
  const quantity = await collectionRepo.setQuantity(card.name, card.quantity + delta);
  const reserved = (card.reserved || []).reduce((a, r) => a + r.count, 0);
  return { quantity, reserved, overflow: reserved > quantity };
}

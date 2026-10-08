// Cas d'usage autour de la collection : import de fichier, ajout manuel, +/−.
import * as collectionRepo from "../data/collectionRepo.js";
import * as decksRepo from "../data/decksRepo.js";
import { enrich, parseCollection } from "../data/scryfall/index.js";

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
  if (merge) {
    for (const c of collection) {
      const cur = await collectionRepo.getCard(c.name);
      await collectionRepo.setQuantity(c.name, (cur?.quantity || 0) + c.quantity, c);
    }
  } else {
    await collectionRepo.saveCollection(collection);
  }
  return { cards: collection.length, copies: collection.reduce((a, c) => a + c.quantity, 0), notFound };
}

/** Ajoute `qty` exemplaires d'une carte trouvée par la recherche Scryfall. Retourne la quantité totale. */
export async function addCard(name, qty, set = "") {
  const cur = await collectionRepo.getCard(name);
  if (cur) return collectionRepo.setQuantity(name, cur.quantity + qty);
  const { collection } = await enrich([{ name, quantity: qty, set }]);
  if (!collection.length) throw new Error("not-found");
  return collectionRepo.setQuantity(collection[0].name, qty, collection[0]);
}

/** +/− sur une carte. Retourne { quantity, reservedOverflow } (exemplaires rangés au-delà du stock). */
export async function changeQuantity(card, delta) {
  const quantity = await collectionRepo.setQuantity(card.name, card.quantity + delta);
  const reserved = (card.reserved || []).reduce((a, r) => a + r.count, 0);
  return { quantity, reserved, overflow: reserved > quantity };
}

// Dépôt « collection » : les cartes possédées (données Scryfall + quantité).
import { reqP, tx } from "./db.js";

export const loadCollection = () => tx("collection", "readonly", s => reqP(s.getAll()));

export function saveCollection(cards) {
  return tx("collection", "readwrite", s => { s.clear(); for (const c of cards) s.put(c); });
}

export async function getCard(name) {
  return tx("collection", "readonly", s => reqP(s.get(name)));
}

/** Fixe la quantité (0 = retirée). `card` = données si la carte est nouvelle. Retourne la quantité. */
export async function setQuantity(name, quantity, card = null) {
  const cur = await getCard(name);
  return tx("collection", "readwrite", s => {
    if (quantity <= 0) { s.delete(name); return 0; }
    if (cur) { s.put({ ...cur, quantity }); return quantity; }
    if (card) { s.put({ ...card, quantity }); return quantity; }
    return null;
  });
}


// Dépôt « collection » : les cartes possédées (données Scryfall + exemplaires), rangées par nom.
// Les anciennes cartes sans exemplaires détaillés sont complétées à la lecture (voir core/copies.js).
import * as copies from "../core/copies.js";
import { reqP, tx } from "./db.js";

/** Carte telle qu'enregistrée → carte avec ses exemplaires (migration à la volée des anciennes données). */
const withDetail = c => (c && !c.copies ? copies.withCopies(c, copies.copiesOf(c)) : c);

export const loadCollection = async () => (await tx("collection", "readonly", s => reqP(s.getAll()))).map(withDetail);

export function saveCollection(cards) {
  return tx("collection", "readwrite", s => { s.clear(); for (const c of cards) s.put(withDetail(c)); });
}

export async function getCard(name) {
  return withDetail(await tx("collection", "readonly", s => reqP(s.get(name))));
}

async function put(card) {
  await tx("collection", "readwrite", s => { if (card.quantity > 0) s.put(card); else s.delete(card.name); });
  return card.quantity;
}

/** Premier exemplaire d'une carte nouvelle, d'après ce qu'on sait de l'impression (scanner, catalogue…). */
const firstCopy = (card, qty) => ({
  set: card.set, set_name: card.set_name, number: card.number || card.collector || "", lang: card.lang || "",
  foil: !!card.foil, qty, price_eur: card.price_eur ?? null, price_foil: card.price_foil ?? null,
});

/**
 * Fixe la quantité totale (0 = retirée). `card` = données si la carte est nouvelle. Retourne la quantité.
 * Ajout : sur le premier exemplaire ; retrait : les exemplaires les moins chers d'abord.
 */
export async function setQuantity(name, quantity, card = null) {
  const cur = await getCard(name);
  if (quantity <= 0) return put({ name, quantity: 0 });
  if (cur) return put(copies.changeTotal(cur, quantity));
  if (!card) return null;
  const base = copies.withCopies(copies.cardData(card), []);
  return put(card.copies?.length ? copies.addCopies(base, card.copies) : copies.addCopies(base, [firstCopy(card, quantity)]));
}

/** Ajoute des exemplaires précis (extension, numéro, langue, foil, état, quantité). Retourne la quantité totale. */
export async function addCopies(card, list) {
  const cur = await getCard(card.name);
  return put(copies.addCopies(cur || copies.withCopies(copies.cardData(card), []), list));
}

/** Retire `n` exemplaires (`filter` : seulement ceux-là, ex. une extension). Retourne la quantité restante. */
export async function removeCopies(name, n, filter = null) {
  const cur = await getCard(name);
  return cur ? put(copies.removeCopies(cur, n, filter)) : 0;
}

/** Modifie un exemplaire (langue, foil, état, quantité…). Retourne la carte mise à jour. */
export async function updateCopy(name, key, changes) {
  const cur = await getCard(name);
  if (!cur) return null;
  const card = copies.updateCopy(cur, key, changes);
  await put(card);
  return card;
}

/** Met à jour des champs de cartes existantes (ex. prix, exemplaires) : { nom: { champ: valeur } }. */
export function updateCards(changes) {
  return tx("collection", "readwrite", s => {
    // lectures et écritures dans les rappels : la transaction reste active
    for (const [name, fields] of Object.entries(changes)) {
      const req = s.get(name);
      req.onsuccess = () => { if (req.result) s.put({ ...withDetail(req.result), ...fields }); };
    }
  });
}

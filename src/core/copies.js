// Exemplaires d'une carte : extension, numéro, langue, foil, état, quantité et prix de chaque impression possédée.
// La collection reste rangée par nom (le moteur de deck raisonne par carte) ; `quantity` = total des exemplaires.
// Pur : chaque fonction renvoie une nouvelle carte.

export const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"];
export const LANGS = ["en", "fr", "de", "it", "es", "pt", "ja", "ko", "ru", "zhs", "zht", "ph"];

/** Exemplaire complet (champs manquants remplis). `card` : valeurs par défaut (extension de la carte). */
export function normCopy(c = {}, card = {}) {
  return {
    set: c.set || card.set || "", set_name: c.set_name || (c.set && c.set !== card.set ? "" : card.set_name || ""),
    number: c.number ? String(c.number) : "", lang: c.lang || "", foil: !!c.foil,
    condition: CONDITIONS.includes(c.condition) ? c.condition : "NM",
    qty: Math.max(0, Math.round(c.qty ?? 1)),
    price_eur: c.price_eur ?? null, price_foil: c.price_foil ?? null,
  };
}

/** Exemplaires d'une carte ; une ancienne carte sans détail donne un seul exemplaire (son extension, état NM). */
export function copiesOf(card) {
  if (card.copies?.length) return card.copies.map(c => normCopy(c, card));
  return card.quantity > 0 ? [normCopy({ set: card.set, set_name: card.set_name, qty: card.quantity }, card)] : [];
}

/** Deux exemplaires identiques (même impression, langue, finition et état) ne font qu'une ligne. */
export const copyKey = c => [c.set, c.number, c.lang, c.foil ? "f" : "", c.condition].join("|");

/** Carte avec ces exemplaires : fusion des identiques, quantités nulles retirées, total recalculé. */
export function withCopies(card, copies) {
  const merged = new Map();
  for (const c of copies) {
    if (c.qty <= 0) continue;
    const k = copyKey(c), cur = merged.get(k);
    if (cur) merged.set(k, { ...cur, qty: cur.qty + c.qty, number: cur.number || c.number, set_name: cur.set_name || c.set_name,
      price_eur: cur.price_eur ?? c.price_eur, price_foil: cur.price_foil ?? c.price_foil });
    else merged.set(k, { ...c });
  }
  const list = [...merged.values()];
  return { ...card, copies: list, quantity: list.reduce((a, c) => a + c.qty, 0) };
}

/** Ajoute des exemplaires ([{ set, number, lang, foil, condition, qty, price_eur, price_foil }]). */
export const addCopies = (card, add) => withCopies(card, [...copiesOf(card), ...add.map(c => normCopy(c, card))]);

/** Prix d'un exemplaire : prix de son impression (foil si foil), sinon prix connu de la carte. */
export function copyPrice(card, c) {
  return c.foil ? c.price_foil ?? c.price_eur ?? card.price_eur ?? 0 : c.price_eur ?? card.price_eur ?? 0;
}

/** Valeur de tous les exemplaires d'une carte. */
export const cardValue = card => copiesOf(card).reduce((a, c) => a + copyPrice(card, c) * c.qty, 0);

/**
 * Retire `n` exemplaires. `filter` : seulement ceux-là (ex. une extension) ; sinon les moins chers d'abord,
 * pour garder les exemplaires de valeur (foil, éditions rares).
 */
export function removeCopies(card, n, filter = null) {
  const list = copiesOf(card);
  const order = list.map((c, i) => ({ c, i })).filter(({ c }) => !filter || filter(c))
    .sort((a, b) => copyPrice(card, a.c) - copyPrice(card, b.c) || (a.c.foil - b.c.foil) || b.i - a.i);
  let left = n;
  for (const { i } of order) {
    if (left <= 0) break;
    const take = Math.min(left, list[i].qty);
    list[i] = { ...list[i], qty: list[i].qty - take };
    left -= take;
  }
  return withCopies(card, list);
}

/**
 * Fixe le total. Ajout : sur l'exemplaire « normal » (non foil, NM, de l'édition de la carte), créé au besoin —
 * jamais sur un foil ou un exemplaire abîmé ; retrait : les moins chers d'abord.
 */
export function changeTotal(card, quantity) {
  const cur = copiesOf(card), total = cur.reduce((a, c) => a + c.qty, 0);
  if (quantity > total) {
    const plain = c => !c.foil && c.condition === "NM";
    let i = cur.findIndex(c => plain(c) && c.set === card.set);
    if (i < 0) i = cur.findIndex(plain);
    const list = [...cur];
    if (i >= 0) list[i] = { ...list[i], qty: list[i].qty + quantity - total };
    else list.push(normCopy({ set: card.set, set_name: card.set_name, qty: quantity - total }, card));
    return withCopies(card, list);
  }
  return removeCopies(card, total - quantity);
}

/** Change un exemplaire (langue, foil, état, quantité…) ; il peut alors fusionner avec un autre. */
export function updateCopy(card, key, changes) {
  return withCopies(card, copiesOf(card).map(c => (copyKey(c) === key ? normCopy({ ...c, ...changes }, card) : c)));
}

export const hasFoil = card => copiesOf(card).some(c => c.foil);
/** Extensions dont on possède au moins un exemplaire. */
export const setsOf = card => [...new Set(copiesOf(card).map(c => c.set).filter(Boolean))];
export const qtyInSet = (card, set) => copiesOf(card).filter(c => c.set === set).reduce((a, c) => a + c.qty, 0);
export const valueInSet = (card, set) => copiesOf(card).filter(c => c.set === set).reduce((a, c) => a + copyPrice(card, c) * c.qty, 0);

/** Données de carte seules (sans les champs propres à une impression lue au scanner ou au catalogue). */
export function cardData(card) {
  const { number, rarity, collector, lang, printed_name, foil, qty, condition, price_foil, card_set, ...data } = card;
  return data;
}

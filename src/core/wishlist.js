// Liste d'envies : cartes à acheter (nombre voulu, prix, d'où vient l'envie). Pur : chaque action renvoie une nouvelle liste.

/** Données gardées pour une carte (de quoi l'afficher sans réseau). */
const keep = c => ({
  name: c.name, set: c.set || "", set_name: c.set_name || "", price_eur: c.price_eur ?? null,
  image: c.image || null, image_small: c.image_small || null, image_back: c.image_back || null,
  mana_cost: c.mana_cost || "", type_line: c.type_line || "", oracle_text: c.oracle_text || "",
  scryfall_uri: c.scryfall_uri || null, fr: c.fr || null,
});

/**
 * Ajoute des cartes : [{ card, count }]. Une carte déjà présente garde le plus grand des deux nombres voulus
 * (ajouter deux fois « 4 Lightning Bolt » ne fait pas 8). `source` : texte libre (ex. nom du deck).
 */
export function addWishes(list, items, { source = "", date = "" } = {}) {
  const out = list.map(w => ({ ...w }));
  for (const { card, count = 1 } of items) {
    const cur = out.find(w => w.name === card.name);
    if (cur) {
      cur.count = Math.max(cur.count, count);
      if (source && !cur.sources.includes(source)) cur.sources = [...cur.sources, source];
    } else out.push({ ...keep(card), count, sources: source ? [source] : [], added: date });
  }
  return out;
}

/** Fixe le nombre voulu (0 = retirée). */
export const setWishCount = (list, name, count) =>
  count <= 0 ? list.filter(w => w.name !== name) : list.map(w => (w.name === name ? { ...w, count } : w));

/** Exemplaires encore à acheter : voulus moins possédés (`owned` : nom → quantité). */
export const stillMissing = (w, owned) => Math.max(0, w.count - (owned[w.name] || 0));

/** Retire les envies déjà satisfaites par la collection. Retourne { list, removed }. */
export function dropOwned(list, owned) {
  const kept = list.filter(w => stillMissing(w, owned) > 0);
  return { list: kept, removed: list.length - kept.length };
}

/** Total à payer pour ce qui manque encore. */
export const wishTotal = (list, owned) => list.reduce((a, w) => a + stillMissing(w, owned) * (w.price_eur || 0), 0);

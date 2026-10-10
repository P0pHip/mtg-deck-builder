// Conversion des objets Scryfall en objets « carte » compacts utilisés par l'appli. Pur.

/** Nom de la face avant (« Ulvenwald Oddity // Ulvenwald Behemoth » → « Ulvenwald Oddity »). */
export const frontName = name => (name || "").split(" // ")[0];

export function backImage(card) {
  const faces = card.card_faces || [];
  if (card.image_uris || faces.length < 2) return null;
  return faces[1].image_uris?.normal || null;
}

/** Prix en euros : normal, ou foil si l'impression n'existe qu'en foil (ex. commandants des decks préconstruits). */
export function priceEur(card) {
  const p = card.prices || {};
  if (p.eur) return parseFloat(p.eur);
  const foilOnly = card.finishes?.length && !card.finishes.includes("nonfoil");
  return foilOnly && p.eur_foil ? parseFloat(p.eur_foil) : null;
}

export function slim(card) {
  const faces = card.card_faces || [];
  const oracle = card.oracle_text || faces.map(f => f.oracle_text || "").join(" // ");
  const images = card.image_uris || faces[0]?.image_uris || {};
  return {
    name: card.name,
    oracle_id: card.oracle_id || faces[0]?.oracle_id || null,
    cmc: card.cmc ?? faces[0]?.cmc ?? 0,
    mana_cost: card.mana_cost || faces[0]?.mana_cost || "",
    type_line: card.type_line || faces.map(f => f.type_line || "").join(" // "),
    oracle_text: oracle,
    colors: card.colors || faces[0]?.colors || [],
    color_identity: card.color_identity || [],
    keywords: card.keywords || [],
    legalities: card.legalities || {},
    edhrec_rank: card.edhrec_rank || null,
    price_eur: priceEur(card),
    price_foil: card.prices?.eur_foil ? parseFloat(card.prices.eur_foil) : null, // prix foil de cette impression (exemplaires foil)
    image: images.normal || null, image_small: images.small || null, image_back: backImage(card),
    scryfall_uri: card.scryfall_uri || null,
    set: card.set || "", set_name: card.set_name || "", released_at: card.released_at || "",
  };
}

export function french(card) {
  const faces = card.card_faces || [];
  const images = card.image_uris || faces[0]?.image_uris || {};
  const j = (f) => faces.map(f).join(" // ");
  return {
    name: faces.length ? j(f => f.printed_name || f.name || "") : (card.printed_name || card.name),
    text: faces.length ? j(f => f.printed_text || f.oracle_text || "") : (card.printed_text || card.oracle_text || ""),
    type_line: faces.length ? j(f => f.printed_type_line || f.type_line || "") : (card.printed_type_line || card.type_line || ""),
    image: images.normal || null, image_small: images.small || null, image_back: backImage(card),
  };
}

export const matchByName = (found, wanted) => {
  const w = wanted.toLowerCase();
  return found.find(c => { const n = c.name.toLowerCase(); return n === w || n.split(" // ")[0] === w; });
};

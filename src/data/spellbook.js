// Combos d'un deck d'après Commander Spellbook (base publique de combos, appels navigateur autorisés), gardés 3 jours.
// On envoie la liste du deck ; le service répond avec les combos déjà complets et ceux auxquels il manque une carte.
import { kvGet, kvSet } from "./db.js";
import { postJSON } from "./scryfall/client.js";

const URL = "https://backend.commanderspellbook.com/find-my-combos";
const TTL = 3 * 24 * 3600 * 1000;
const MAX_PAGES = 4;

/** Combo du service → ce que l'appli garde. Pur. */
export function slimVariant(v) {
  return {
    id: v.id,
    cards: (v.uses || []).map(u => u.card?.name).filter(Boolean),
    requires: (v.requires || []).map(r => r.template?.name).filter(Boolean), // « une créature avec… » (n'importe laquelle)
    produces: (v.produces || []).map(p => p.feature?.name).filter(Boolean),
    description: v.description || "",
    prerequisites: [v.easyPrerequisites, v.notablePrerequisites].filter(Boolean).join("\n"),
    mana: v.manaNeeded || "",
    popularity: v.popularity || 0,
    legal: v.legalities || null,
  };
}

/** Petite empreinte d'une liste de noms (clé du cache). Pur. */
export function listKey(names) {
  let h = 5381;
  for (const ch of [...names].sort().join("|")) h = ((h << 5) + h + ch.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Combos complets ou presque (une carte manquante) pour ces cartes. `commanders`, `main` : noms anglais.
 * Retourne les combos « slim » (voir slimVariant), sans doublon.
 */
export async function findCombos({ commanders = [], main = [] }) {
  const key = `spellbook:${listKey([...commanders.map(n => "*" + n), ...main])}`;
  const hit = await kvGet(key);
  if (hit && Date.now() - hit.at < TTL) return hit.variants;
  const body = { commanders: commanders.map(card => ({ card })), main: main.map(card => ({ card })) };
  const seen = new Map();
  let url = URL;
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const j = await postJSON(url, body);
    for (const v of [...(j.results?.included || []), ...(j.results?.almostIncluded || [])]) if (!seen.has(v.id)) seen.set(v.id, slimVariant(v));
    url = j.next || null;
  }
  const variants = [...seen.values()];
  await kvSet(key, { at: Date.now(), variants });
  return variants;
}

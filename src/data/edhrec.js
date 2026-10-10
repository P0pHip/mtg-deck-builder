// Synergies réelles d'un commandant d'après EDHREC (JSON public, appels navigateur autorisés), gardées 14 jours.
// Pour chaque carte : `inclusion` (part des decks de ce commandant qui la jouent) et `synergy` (−1..1 : à quel point
// elle est plus jouée avec ce commandant qu'ailleurs).
import { kvGet, kvSet } from "./db.js";
import { getJSON } from "./scryfall/client.js";

const BASE = "https://json.edhrec.com/pages/commanders";
const TTL = 14 * 24 * 3600 * 1000;

/** Nom de carte → identifiant de page EDHREC (« Atraxa, Praetors' Voice » → « atraxa-praetors-voice »). Pur. */
export function edhrecSlug(name) {
  return (name || "").split(" // ")[0].toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "").trim().replace(/[\s-]+/g, "-");
}

/** Page commandant EDHREC → [[nom, { synergy, inclusion }]] (toutes les listes, sans doublon). Pur. */
export function parseCommanderPage(json) {
  const out = new Map();
  for (const list of json?.container?.json_dict?.cardlists || []) {
    for (const v of list.cardviews || []) {
      if (!v?.name || !v.potential_decks) continue;
      const e = { synergy: Math.round((v.synergy || 0) * 1000) / 1000, inclusion: Math.round(v.num_decks / v.potential_decks * 1000) / 1000 };
      const cur = out.get(v.name);
      if (!cur || e.inclusion > cur.inclusion) out.set(v.name, e);
    }
  }
  return [...out];
}

/**
 * Synergies d'un commandant : Map (nom de carte en minuscules, et sa face avant) → { synergy, inclusion },
 * ou null si EDHREC est injoignable ou ne connaît pas ce commandant (l'appli fait alors sans).
 */
export async function commanderSynergies(name) {
  const slug = edhrecSlug(name), key = `edhrec:${slug}`;
  if (!slug) return null;
  let hit = await kvGet(key);
  if (!hit || Date.now() - hit.at > TTL) {
    try {
      const json = await getJSON(`${BASE}/${slug}.json`);
      hit = { at: Date.now(), cards: json ? parseCommanderPage(json) : [] };
      await kvSet(key, hit);
    } catch (e) {
      // commandant inconnu d'EDHREC (403, 404…) : mémorisé, pour ne pas redemander à chaque génération ; 429 (trop de requêtes) ne l'est pas
      if (/\b(400|403|404|410)\b/.test(e.message)) { hit = { at: Date.now(), cards: [] }; await kvSet(key, hit); }
      else if (!hit) return null; // hors ligne : on garde l'ancienne version si on l'a
    }
  }
  if (!hit.cards.length) return null;
  const map = new Map();
  for (const [n, e] of hit.cards) { map.set(n.toLowerCase(), e); map.set(n.split(" // ")[0].toLowerCase(), e); }
  return map;
}

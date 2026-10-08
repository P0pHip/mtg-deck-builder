// Liste des extensions Magic (nom complet + icône), chargée une fois depuis Scryfall et gardée 30 jours.
import { kvGet, kvSet } from "../db.js";
import { API, getJSON } from "./client.js";

const KEY = "scryfall_sets";
const TTL = 30 * 24 * 3600 * 1000;
let memo = null;

/** Map code → { name, icon, released } (icon = URL de l'icône SVG officielle). */
export async function getSets() {
  if (memo) return memo;
  const hit = await kvGet(KEY);
  if (hit && Date.now() - hit.at < TTL) return (memo = new Map(hit.sets));
  try {
    const j = await getJSON(`${API}/sets`);
    const sets = (j?.data || []).map(s => [s.code, { name: s.name, icon: s.icon_svg_uri, released: s.released_at }]);
    await kvSet(KEY, { at: Date.now(), sets });
    return (memo = new Map(sets));
  } catch {
    return (memo = new Map(hit?.sets || [])); // hors ligne : ancienne liste si on l'a
  }
}

/** URL d'icône de repli quand la liste n'est pas encore chargée. */
export const fallbackIcon = code => `https://svgs.scryfall.io/sets/${encodeURIComponent(code)}.svg`;

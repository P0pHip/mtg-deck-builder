// Liste des extensions Magic (nom complet + icône), chargée une fois depuis Scryfall et gardée 30 jours.
import { kvGet, kvSet } from "../db.js";
import { API, getJSON } from "./client.js";

const KEY = "scryfall_sets_v2";
const TTL = 30 * 24 * 3600 * 1000;
let memo = null;

/** Map code → { name, icon, released, type, count, digital } (icon = URL de l'icône SVG officielle). */
export async function getSets() {
  if (memo) return memo;
  const hit = await kvGet(KEY);
  if (hit && Date.now() - hit.at < TTL) return (memo = new Map(hit.sets));
  try {
    const j = await getJSON(`${API}/sets`);
    const sets = (j?.data || []).map(s => [s.code, { name: s.name, icon: s.icon_svg_uri, released: s.released_at, type: s.set_type, count: s.card_count, digital: !!s.digital }]);
    await kvSet(KEY, { at: Date.now(), sets });
    return (memo = new Map(sets));
  } catch {
    return (memo = new Map(hit?.sets || [])); // hors ligne : ancienne liste si on l'a
  }
}

/** URL d'icône de repli quand la liste n'est pas encore chargée. */
export const fallbackIcon = code => `https://svgs.scryfall.io/sets/${encodeURIComponent(code)}.svg`;

// types d'extensions qu'on peut parcourir (pas les jetons, promos, cartes en ligne…)
const BROWSABLE = new Set(["core", "expansion", "masters", "draft_innovation", "commander", "starter", "funny", "box", "duel_deck", "from_the_vault", "spellbook", "premium_deck", "planechase", "archenemy", "masterpiece", "arsenal"]);

/** Extensions papier parcourables, les plus récentes d'abord : [{ code, name, icon, released, count }]. */
export async function browsableSets() {
  const all = await getSets();
  const today = new Date().toISOString().slice(0, 10);
  return [...all].filter(([, s]) => !s.digital && BROWSABLE.has(s.type) && s.count > 0 && (s.released || "") <= today)
    .map(([code, s]) => ({ code, ...s }))
    .sort((a, b) => (b.released || "").localeCompare(a.released || "") || a.name.localeCompare(b.name));
}

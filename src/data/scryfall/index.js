// Fonctions Scryfall de haut niveau : enrichissement (EN + FR) avec cache local, recherche, meilleures cartes.
import { kvGet, kvSet } from "../db.js";
import { API, getJSON, postCollection, searchUrl } from "./client.js";
import { french, matchByName as match, slim } from "./mappers.js";

export { parseCollection, parseCSV } from "./importer.js";
const CACHE_KEY = "scryfall_cards";
const TOP_TTL = 7 * 24 * 3600 * 1000;

/** Ajoute la version FR (nom, texte, type, images) aux cartes du cache, par paquets de 20. */
export async function addFrench(cache, keys) {
  const todo = keys.filter(k => cache[k] && !("fr" in cache[k]) && cache[k].oracle_id);
  for (let i = 0; i < todo.length; i += 20) {
    const batch = todo.slice(i, i + 20);
    const q = "lang:fr (" + batch.map(k => `oracleid:${cache[k].oracle_id}`).join(" or ") + ")";
    let url = searchUrl({ q, unique: "cards", include_multilingual: "true" });
    const found = {};
    while (url) {
      const j = await getJSON(url);
      if (!j) break;
      for (const c of j.data) found[c.oracle_id || c.card_faces?.[0]?.oracle_id] = french(c);
      url = j.has_more ? j.next_page : null;
    }
    for (const k of batch) cache[k].fr = found[cache[k].oracle_id] || null;
  }
}

/** Enrichit [{name, quantity, set}] avec Scryfall. Retourne {collection, notFound}. */
export async function enrich(entries, progress = () => {}) {
  const cache = (await kvGet(CACHE_KEY)) || {};
  const todo = entries.filter(e => !cache[e.name.toLowerCase()] || !("image_back" in cache[e.name.toLowerCase()]));
  for (let i = 0; i < todo.length; i += 75) {
    const batch = todo.slice(i, i + 75);
    const found = (await postCollection(batch.map(e => (e.set ? { name: e.name, set: e.set } : { name: e.name })))).data;
    const retry = [];
    for (const e of batch) {
      const c = match(found, e.name);
      if (c) cache[e.name.toLowerCase()] = slim(c);
      else if (e.set) retry.push(e); // mauvais code d'extension → on réessaie avec le nom seul
    }
    if (retry.length) {
      const found2 = (await postCollection(retry.map(e => ({ name: e.name })))).data;
      for (const e of retry) { const c = match(found2, e.name); if (c) cache[e.name.toLowerCase()] = slim(c); }
    }
    progress(Math.min(i + 75, todo.length), todo.length, "en");
  }
  try {
    progress(0, 1, "fr");
    await addFrench(cache, entries.map(e => e.name.toLowerCase()));
  } catch (e) { console.warn("Traduction FR incomplète", e); }
  await kvSet(CACHE_KEY, cache);

  const collection = [], notFound = [];
  for (const e of entries) {
    const d = cache[e.name.toLowerCase()];
    if (d) collection.push({ ...d, quantity: e.quantity, set: e.set || d.set || "", set_name: e.set && e.set !== d.set ? "" : d.set_name || "" });
    else notFound.push(e.name);
  }
  return { collection, notFound };
}

/**
 * Recherche pour l'ajout manuel. En FR, cherche aussi les noms imprimés en français.
 * options : colors (ex. ["R","G"], "C" = incolore, "M" = multicolore), order ("edhrec" | "name" | "released" | "cmc").
 */
export async function search(text, lang = "fr", limit = 16, { colors = [], order = "edhrec" } = {}) {
  const results = [], seen = new Set();
  let filter = "";
  if (colors.includes("C")) filter = " c=c";
  else if (colors.includes("M")) filter = " c>=2" + (colors.filter(c => c !== "M").length ? ` c>=${colors.filter(c => c !== "M").join("")}` : "");
  else if (colors.length) filter = ` c>=${colors.join("")}`;
  const queries = [...(lang === "fr" ? [[`${text}${filter} lang:fr`, true]] : []), [`${text}${filter}`, false]];
  for (const [q, ml] of queries) {
    let j;
    try {
      j = await getJSON(searchUrl({ q, unique: "cards", order, ...(order === "released" ? { dir: "desc" } : {}), ...(ml ? { include_multilingual: "true" } : {}) }));
    } catch { continue; }
    for (const c of j?.data || []) {
      if (seen.has(c.name)) continue;
      seen.add(c.name);
      const faces = c.card_faces || [];
      const img = c.image_uris || faces[0]?.image_uris || {};
      results.push({
        name: c.name, printed_name: c.lang !== "en" ? c.printed_name || null : null,
        type_line: c.printed_type_line || c.type_line || "", mana_cost: c.mana_cost || faces[0]?.mana_cost || "",
        color_identity: c.color_identity || [],
        set: c.set, set_name: c.set_name, image_small: img.small || null, image: img.normal || null,
      });
      if (results.length >= limit) return results;
    }
  }
  return results;
}

/** Toutes les impressions (extensions) d'une carte, de la plus récente à la plus ancienne. */
export async function prints(name) {
  const out = [], seen = new Set();
  let url = searchUrl({ q: `!"${name.replace(/"/g, "")}" game:paper`, unique: "prints", order: "released", dir: "desc" });
  while (url && out.length < 80) {
    const j = await getJSON(url);
    if (!j) break;
    for (const c of j.data) {
      if (seen.has(c.set)) continue;
      seen.add(c.set);
      const img = c.image_uris || c.card_faces?.[0]?.image_uris || {};
      out.push({ set: c.set, set_name: c.set_name, released_at: c.released_at, image_small: img.small || null,
        price_eur: c.prices?.eur ? parseFloat(c.prices.eur) : null });
    }
    url = j.has_more ? j.next_page : null;
  }
  return out;
}

/** Cartes les plus jouées (rang EDHREC) du format et des couleurs. Cache 1 semaine. */
export async function topCards(fmt, identity, pages = 2) {
  const ident = [..."WUBRG"].filter(c => identity.includes(c)).join("") || "C";
  const key = `top:${fmt}:${ident}`;
  const hit = await kvGet(key);
  if (hit && Date.now() - hit.at < TOP_TTL) return hit.cards;
  let url = searchUrl({ q: `f:${fmt} id<=${ident} -t:basic -is:funny game:paper`, order: "edhrec", unique: "cards" });
  const cards = [];
  for (let p = 0; p < pages && url; p++) {
    const j = await getJSON(url);
    if (!j) break;
    cards.push(...j.data.map(slim));
    url = j.has_more ? j.next_page : null;
  }
  await kvSet(key, { at: Date.now(), cards });
  return cards;
}

/** Ajoute la version FR à une petite liste de cartes (en place). */
export async function frenchFor(cards) {
  const tmp = {};
  for (const c of cards) if (!("fr" in c)) tmp[c.name.toLowerCase()] = c;
  try { await addFrench(tmp, Object.keys(tmp)); } catch { /* le FR est un bonus */ }
  return cards;
}

/** Cartes du format et des couleurs dont le texte contient un des termes (ex. « blood »). Cache 1 semaine. */
export async function themeCards(fmt, identity, terms, limit = 120) {
  if (!terms?.length) return [];
  const ident = [..."WUBRG"].filter(c => identity.includes(c)).join("") || "C";
  const oracle = terms.map(t => `o:"${t.replace(/"/g, "")}"`).join(" or ");
  const key = `theme:${fmt}:${ident}:${terms.join(",")}`;
  const hit = await kvGet(key);
  if (hit && Date.now() - hit.at < TOP_TTL) return hit.cards;
  let url = searchUrl({ q: `f:${fmt} id<=${ident} (${oracle}) -t:basic game:paper`, order: "edhrec", unique: "cards" });
  const cards = [];
  while (url && cards.length < limit) {
    const j = await getJSON(url);
    if (!j) break;
    cards.push(...j.data.map(slim));
    url = j.has_more ? j.next_page : null;
  }
  await kvSet(key, { at: Date.now(), cards });
  return cards;
}

/**
 * Retrouve une carte par un nom approximatif, en anglais ou en français (« olivia mariee ecarlate »).
 * Retourne la carte complète (avec version FR) ou null. Rien n'est ajouté à la collection.
 */
export async function lookupCard(name, lang = "fr") {
  const q = name.trim();
  if (q.length < 3) return null;
  let english = null;
  const named = await getJSON(`${API}/cards/named?` + new URLSearchParams({ fuzzy: q })).catch(() => null);
  if (named?.name) english = named.name;
  if (!english) {
    const found = await search(q, lang, 1).catch(() => []);
    english = found[0]?.name || null;
  }
  if (!english) return null;
  const { collection } = await enrich([{ name: english, quantity: 0, set: "" }]);
  return collection[0] || null;
}

/** Recherche Scryfall brute → cartes complètes (avec version FR), les plus jouées d'abord. */
export async function searchCards(query, limit = 8) {
  const j = await getJSON(searchUrl({ q: query, order: "edhrec", unique: "cards" }));
  const cards = (j?.data || []).slice(0, limit).map(slim);
  const tmp = Object.fromEntries(cards.map(c => [c.name.toLowerCase(), c]));
  try { await addFrench(tmp, Object.keys(tmp)); } catch { /* le FR est un bonus */ }
  return cards;
}

// Fonctions Scryfall de haut niveau : enrichissement (EN + FR) avec cache local, recherche, meilleures cartes.
import { kvGet, kvSet } from "../db.js";
import { API, getJSON, postCollection, searchUrl } from "./client.js";
import { similarity } from "../../core/scan.js";
import { french, frontName, matchByName as match, priceEur, slim } from "./mappers.js";

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
    // Scryfall ne reconnaît pas le nom complet « A // B » des cartes recto-verso : on cherche par la face avant
    const found = (await postCollection(batch.map(e => (e.set ? { name: frontName(e.name), set: e.set } : { name: frontName(e.name) })))).data;
    const retry = [];
    for (const e of batch) {
      const c = match(found, e.name);
      if (c) cache[e.name.toLowerCase()] = slim(c);
      else if (e.set) retry.push(e); // mauvais code d'extension → on réessaie avec le nom seul
    }
    if (retry.length) {
      const found2 = (await postCollection(retry.map(e => ({ name: frontName(e.name) })))).data;
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
    // détails de l'exemplaire (numéro, langue, foil, état) gardés pour l'import ; card_set : impression dont on a le prix
    if (d) collection.push({ ...d, quantity: e.quantity, set: e.set || d.set || "", set_name: e.set && e.set !== d.set ? "" : d.set_name || "",
      number: e.number || "", lang: e.lang || "", foil: !!e.foil, condition: e.condition || "NM", card_set: d.set || "" });
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
      // carte complète (comme dans la collection) : la fiche et l'ajout n'ont pas besoin d'un nouvel appel
      const card = slim(c);
      if (c.lang && c.lang !== "en") card.fr = french(c);
      results.push({
        ...card, card,
        printed_name: c.lang !== "en" ? c.printed_name || (card.fr?.name ?? null) : null,
        type_line: c.printed_type_line || card.type_line,
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
      out.push({ set: c.set, set_name: c.set_name, released_at: c.released_at, image_small: img.small || null, number: c.collector_number || "",
        price_eur: c.prices?.eur ? parseFloat(c.prices.eur) : null, price_foil: c.prices?.eur_foil ? parseFloat(c.prices.eur_foil) : null });
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

const SET_TTL = 7 * 24 * 3600 * 1000;
const RARITY = { common: "C", uncommon: "U", rare: "R", mythic: "M", special: "S", bonus: "S" };

/**
 * Catalogue complet d'une extension (une entrée par carte, dans l'ordre de l'extension), avec la version FR.
 * Gardé 7 jours. onProgress(texte) pour l'affichage.
 */
export async function setCatalog(code, { onProgress = () => {} } = {}) {
  const key = `set:${code}`;
  const hit = await kvGet(key);
  if (hit && Date.now() - hit.at < SET_TTL) return hit.cards;
  const cards = [];
  let url = searchUrl({ q: `e:${code} game:paper`, unique: "cards", order: "set" });
  while (url) {
    const j = await getJSON(url);
    if (!j) break;
    for (const c of j.data) cards.push({ ...slim(c), set: code, rarity: RARITY[c.rarity] || "S", number: c.collector_number || "" });
    onProgress(cards.length, j.total_cards || cards.length);
    url = j.has_more ? j.next_page : null;
  }
  // noms FR : d'abord les impressions françaises de l'extension, puis par oracle_id pour le reste
  const byOracle = new Map(cards.map(c => [c.oracle_id, c]));
  try {
    url = searchUrl({ q: `e:${code} lang:fr`, unique: "cards", include_multilingual: "true" });
    while (url) {
      const j = await getJSON(url);
      if (!j) break;
      for (const c of j.data) { const k = byOracle.get(c.oracle_id || c.card_faces?.[0]?.oracle_id); if (k) k.fr = french(c); }
      url = j.has_more ? j.next_page : null;
    }
    const tmp = Object.fromEntries(cards.filter(c => !c.fr).map(c => [c.name.toLowerCase(), c]));
    await addFrench(tmp, Object.keys(tmp));
  } catch { /* le FR est un bonus */ }
  await kvSet(key, { at: Date.now(), cards });
  return cards;
}

// ------------------------------------------------------------ scanner
/** Carte Scryfall → carte « collection » (avec la version FR quand on l'a). */
async function toCollectionCard(c) {
  const card = slim(c);
  if (c.lang === "fr") card.fr = french(c);
  else {
    const tmp = { k: card };
    try { await addFrench(tmp, ["k"]); } catch { /* le FR est un bonus */ }
  }
  return { ...card, printed_name: c.lang !== "en" ? c.printed_name || null : null, lang: c.lang || "en", collector: c.collector_number || "" };
}

/** Impression exacte par extension + numéro de collection (+ langue si possible). */
export async function printByNumber(set, number, lang = null) {
  const base = `${API}/cards/${encodeURIComponent(set)}/${encodeURIComponent(number)}`;
  let c = lang && lang !== "en" ? await getJSON(`${base}/${lang}`).catch(() => null) : null;
  if (!c) c = await getJSON(base).catch(() => null);
  return c?.object === "card" ? toCollectionCard(c) : null;
}

/** Carte par nom approché (EN via la recherche floue de Scryfall, sinon nom imprimé FR). */
export async function cardByReadName(text, lang = "fr") {
  let c = await getJSON(`${API}/cards/named?` + new URLSearchParams({ fuzzy: text })).catch(() => null);
  if (c?.object !== "card" && lang === "fr") {
    const j = await getJSON(searchUrl({ q: `${text} lang:fr`, include_multilingual: "true", unique: "prints" })).catch(() => null);
    c = j?.data?.[0] || null;
  }
  return c?.object === "card" ? toCollectionCard(c) : null;
}

// ------------------------------------------------------------ decks préconstruits
/** Cartes par identifiant Scryfall (impressions exactes), avec la version FR. Retourne une Map id → carte. */
export async function cardsByIds(ids, { onProgress = () => {} } = {}) {
  const unique = [...new Set(ids)], out = new Map();
  for (let i = 0; i < unique.length; i += 75) {
    const found = (await postCollection(unique.slice(i, i + 75).map(id => ({ id })))).data || [];
    for (const c of found) out.set(c.id, { ...slim(c), number: c.collector_number || "" });
    onProgress(Math.min(i + 75, unique.length), unique.length);
  }
  // une même carte peut apparaître sous plusieurs impressions : FR demandé une fois par nom
  const byName = {};
  for (const c of out.values()) byName[c.name.toLowerCase()] ||= c;
  try { await addFrench(byName, Object.keys(byName)); } catch { /* le FR est un bonus */ }
  for (const c of out.values()) if (!("fr" in c)) c.fr = byName[c.name.toLowerCase()]?.fr || null;
  return out;
}

// ------------------------------------------------------------ import de decklist
const fold = s => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const sameName = (card, name) => {
  const a = fold(card.name), b = fold(name);
  return a === b || fold(frontName(card.name)) === fold(frontName(name));
};

/**
 * Lignes de decklist [{ name, set, number }] → cartes (même ordre ; null si introuvable), avec la version FR.
 * Ordre d'essai : extension + numéro (impression exacte, si le nom concorde), nom + extension, nom seul (face avant),
 * puis recherche approchée (fautes de frappe, noms français).
 */
export async function resolveDeckLines(lines, { lang = "fr", onProgress = () => {} } = {}) {
  const out = new Array(lines.length).fill(null);
  const ident = l => (l.set && l.number ? { set: l.set, collector_number: l.number } : l.set ? { name: frontName(l.name), set: l.set } : { name: frontName(l.name) });
  // le nom doit toujours concorder : un numéro faux (ou d'une autre édition) donnerait une autre carte
  const matches = (c, l, id) => sameName(c, l.name) && (id.collector_number ? c.set === id.set && c.collector_number === id.collector_number : !id.set || c.set === id.set);
  const pass = async (todo, makeId) => {
    for (let i = 0; i < todo.length; i += 75) {
      const batch = todo.slice(i, i + 75), ids = batch.map(k => makeId(lines[k]));
      const found = (await postCollection(ids)).data || [];
      batch.forEach((k, j) => { const c = found.find(f => matches(f, lines[k], ids[j])); if (c) out[k] = slim(c); });
    }
  };
  const missing = () => lines.map((_, k) => k).filter(k => !out[k]);
  await pass(missing(), ident);
  onProgress(1, 3);
  await pass(missing().filter(k => lines[k].set && lines[k].number), l => ({ name: frontName(l.name), set: l.set })); // mauvais numéro
  await pass(missing().filter(k => lines[k].set), l => ({ name: frontName(l.name) })); // mauvaise extension
  onProgress(2, 3);
  for (const k of missing()) {
    const name = lines[k].name;
    let c = await getJSON(`${API}/cards/named?` + new URLSearchParams({ fuzzy: name })).catch(() => null);
    // la recherche floue tolère les fautes de frappe, mais peut aussi tomber sur une carte sans rapport
    if (c?.object === "card" && similarity(name, c.name) < 0.75) c = null;
    if (c?.object !== "card") {
      // nom imprimé (ex. français) : on ne garde la carte que si le nom correspond vraiment
      const j = await getJSON(searchUrl({ q: `${name} lang:${lang === "en" ? "any" : lang}`, include_multilingual: "true", unique: "prints" })).catch(() => null);
      c = (j?.data || []).find(x => [x.printed_name, ...(x.card_faces || []).map(f => f.printed_name)].some(n => n && fold(frontName(n)) === fold(frontName(name)))) || null;
      if (c && c.lang !== "en") c = (await getJSON(`${API}/cards/${c.set}/${encodeURIComponent(c.collector_number)}`).catch(() => null)) || c;
    }
    if (c?.object === "card") out[k] = slim(c);
  }
  onProgress(3, 3);
  const byName = {};
  for (const c of out) if (c) byName[c.name.toLowerCase()] ||= c;
  try { await addFrench(byName, Object.keys(byName)); } catch { /* le FR est un bonus */ }
  for (const c of out) if (c && !("fr" in c)) c.fr = byName[c.name.toLowerCase()]?.fr || null;
  return out;
}

// ------------------------------------------------------------ prix
/**
 * Prix actuels (EUR) des cartes de la collection, dans leur extension : { nom: prix }.
 * Par paquets de 75 ; une carte absente de son extension (ou sans prix) est cherchée par son seul nom.
 * Une carte toujours sans prix n'apparaît pas : son ancien prix est conservé.
 */
export async function currentPrices(cards, { onProgress = () => {} } = {}) {
  const out = {};
  for (let i = 0; i < cards.length; i += 75) {
    const batch = cards.slice(i, i + 75);
    const found = (await postCollection(batch.map(c => (c.set ? { name: frontName(c.name), set: c.set } : { name: frontName(c.name) })))).data || [];
    const retry = [];
    for (const c of batch) {
      const f = found.find(x => sameName(x, c.name) && (!c.set || x.set === c.set));
      if (f && priceEur(f) != null) out[c.name] = priceEur(f); else retry.push(c);
    }
    if (retry.length) {
      const again = (await postCollection(retry.map(c => ({ name: frontName(c.name) })))).data || [];
      for (const c of retry) { const f = again.find(x => sameName(x, c.name)); if (f && priceEur(f) != null) out[c.name] = priceEur(f); }
    }
    onProgress(Math.min(i + 75, cards.length), cards.length);
  }
  return out;
}

/**
 * Prix de chaque impression possédée (exemplaires) : Map clé → { eur, foil }.
 * Clé : extension + numéro si on le connaît, sinon extension + nom (voir copyPriceKey).
 */
export const copyPriceKey = (name, cp) => (cp.number ? `n:${cp.set}:${cp.number}` : `s:${cp.set}:${frontName(name).toLowerCase()}`);

export async function copyPrices(cards, { onProgress = () => {} } = {}) {
  const ids = new Map();
  for (const c of cards) {
    for (const cp of c.copies || []) {
      if (!cp.set) continue;
      ids.set(copyPriceKey(c.name, cp), cp.number ? { set: cp.set, collector_number: cp.number } : { name: frontName(c.name), set: cp.set });
    }
  }
  const out = new Map(), list = [...ids.values()];
  for (let i = 0; i < list.length; i += 75) {
    const found = (await postCollection(list.slice(i, i + 75))).data || [];
    for (const f of found) {
      const p = { eur: priceEur(f), foil: f.prices?.eur_foil ? parseFloat(f.prices.eur_foil) : null };
      out.set(`n:${f.set}:${f.collector_number}`, p);
      const k = `s:${f.set}:${frontName(f.name).toLowerCase()}`;
      if (!out.has(k)) out.set(k, p);
    }
    onProgress(Math.min(i + 75, list.length), list.length);
  }
  return out;
}

const RULINGS_TTL = 30 * 24 * 3600 * 1000;

/**
 * Précisions de règles officielles d'une carte (en anglais, publiées par Wizards ou Scryfall), gardées 30 jours :
 * [{ date, text, source }], de la plus ancienne à la plus récente. [] si aucune.
 */
export async function rulings(name) {
  const front = frontName(name), key = `rulings:${front.toLowerCase()}`;
  const hit = await kvGet(key);
  if (hit && Date.now() - hit.at < RULINGS_TTL) return hit.list;
  const card = await getJSON(`${API}/cards/named?` + new URLSearchParams({ exact: front }));
  const r = card?.rulings_uri ? await getJSON(card.rulings_uri) : null;
  const list = (r?.data || []).map(x => ({ date: x.published_at || "", text: x.comment || "", source: x.source || "" }));
  await kvSet(key, { at: Date.now(), list });
  return list;
}
// Accès à l'API Scryfall depuis le navigateur (Scryfall autorise les appels cross-origin).
// Cache local dans IndexedDB : chaque carte n'est téléchargée qu'une fois.
import { kvGet, kvSet } from "./store.js";

const API = "https://api.scryfall.com";
const HEADERS = { Accept: "application/json" };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CACHE_KEY = "scryfall_cards";
const TOP_TTL = 7 * 24 * 3600 * 1000;

// ------------------------------------------------------------- lecture fichier
function parseCSV(text) {
  const rows = []; let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === "," || ch === ";" || ch === "\t") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some(f => f.trim())) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field); if (row.some(f => f.trim())) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map(h => h.trim());
  return rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

const NAME_KEYS = ["name", "card", "card_name", "nom"];
const QTY_KEYS = ["quantity", "qty", "count", "quantite", "quantité"];
const SET_KEYS = ["set_code", "set", "edition_code", "edition", "extension"];
function pick(row, keys, def = null) {
  const low = {};
  for (const [k, v] of Object.entries(row)) if (k) low[k.trim().toLowerCase().replace(/ /g, "_")] = v;
  for (const k of keys) if (low[k] !== undefined && String(low[k]).trim()) return String(low[k]).trim();
  return def;
}

/** [{name, quantity, set}] depuis un CSV ou un JSON (fusionne les doublons). */
export function parseCollection(filename, text) {
  text = text.replace(/^﻿/, "");
  let rows;
  if (filename.toLowerCase().endsWith(".json")) {
    let data = JSON.parse(text);
    if (!Array.isArray(data)) data = data.cards || data.data || data.collection || Object.values(data);
    rows = data;
  } else rows = parseCSV(text);
  const merged = new Map();
  for (const row of rows) {
    const name = pick(row, NAME_KEYS);
    if (!name) continue;
    const qty = parseInt(parseFloat(pick(row, QTY_KEYS, "1")), 10) || 1;
    const set = (pick(row, SET_KEYS, "") || "").toLowerCase();
    const k = name.toLowerCase();
    if (merged.has(k)) merged.get(k).quantity += qty; else merged.set(k, { name, quantity: qty, set });
  }
  return [...merged.values()];
}

// ---------------------------------------------------------- données Scryfall
function backImage(card) {
  const faces = card.card_faces || [];
  if (card.image_uris || faces.length < 2) return null;
  return faces[1].image_uris?.normal || null;
}

export function slim(card) {
  const faces = card.card_faces || [];
  const oracle = card.oracle_text || faces.map(f => f.oracle_text || "").join(" // ");
  const images = card.image_uris || faces[0]?.image_uris || {};
  return {
    name: card.name,
    oracle_id: card.oracle_id || faces[0]?.oracle_id || null,
    cmc: card.cmc || 0,
    mana_cost: card.mana_cost || faces[0]?.mana_cost || "",
    type_line: card.type_line || "",
    oracle_text: oracle,
    colors: card.colors || faces[0]?.colors || [],
    color_identity: card.color_identity || [],
    keywords: card.keywords || [],
    legalities: card.legalities || {},
    edhrec_rank: card.edhrec_rank || null,
    price_eur: card.prices?.eur ? parseFloat(card.prices.eur) : null,
    image: images.normal || null, image_small: images.small || null, image_back: backImage(card),
    scryfall_uri: card.scryfall_uri || null,
  };
}

function french(card) {
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

async function getJSON(url) {
  const r = await fetch(url, { headers: HEADERS });
  await sleep(110); // Scryfall demande ~10 requêtes/s max
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Scryfall ${r.status}`);
  return r.json();
}

async function postCollection(identifiers) {
  const r = await fetch(`${API}/cards/collection`, {
    method: "POST", headers: { ...HEADERS, "Content-Type": "application/json" }, body: JSON.stringify({ identifiers }),
  });
  await sleep(110);
  if (!r.ok) throw new Error(`Scryfall ${r.status}`);
  return r.json();
}

const match = (found, wanted) => {
  const w = wanted.toLowerCase();
  return found.find(c => { const n = c.name.toLowerCase(); return n === w || n.split(" // ")[0] === w; });
};

/** Ajoute la version FR (nom, texte, type, images) aux cartes du cache, par paquets de 20. */
export async function addFrench(cache, keys) {
  const todo = keys.filter(k => cache[k] && !("fr" in cache[k]) && cache[k].oracle_id);
  for (let i = 0; i < todo.length; i += 20) {
    const batch = todo.slice(i, i + 20);
    const q = "lang:fr (" + batch.map(k => `oracleid:${cache[k].oracle_id}`).join(" or ") + ")";
    let url = `${API}/cards/search?` + new URLSearchParams({ q, unique: "cards", include_multilingual: "true" });
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
    if (d) collection.push({ ...d, quantity: e.quantity, set: e.set }); else notFound.push(e.name);
  }
  return { collection, notFound };
}

/** Recherche pour l'ajout manuel. En FR, cherche aussi les noms imprimés en français. */
export async function search(text, lang = "fr", limit = 16) {
  const results = [], seen = new Set();
  const queries = [...(lang === "fr" ? [[`${text} lang:fr`, true]] : []), [text, false]];
  for (const [q, ml] of queries) {
    let j;
    try {
      j = await getJSON(`${API}/cards/search?` + new URLSearchParams({ q, unique: "cards", order: "edhrec", ...(ml ? { include_multilingual: "true" } : {}) }));
    } catch { continue; }
    for (const c of j?.data || []) {
      if (seen.has(c.name)) continue;
      seen.add(c.name);
      const faces = c.card_faces || [];
      const img = c.image_uris || faces[0]?.image_uris || {};
      results.push({
        name: c.name, printed_name: c.lang !== "en" ? c.printed_name || null : null,
        type_line: c.printed_type_line || c.type_line || "", mana_cost: c.mana_cost || faces[0]?.mana_cost || "",
        set: c.set, set_name: c.set_name, image_small: img.small || null, image: img.normal || null,
      });
      if (results.length >= limit) return results;
    }
  }
  return results;
}

/** Cartes les plus jouées (rang EDHREC) du format et des couleurs. Cache 1 semaine. */
export async function topCards(fmt, identity, pages = 2) {
  const ident = [..."WUBRG"].filter(c => identity.includes(c)).join("") || "C";
  const key = `top:${fmt}:${ident}`;
  const hit = await kvGet(key);
  if (hit && Date.now() - hit.at < TOP_TTL) return hit.cards;
  let url = `${API}/cards/search?` + new URLSearchParams({ q: `f:${fmt} id<=${ident} -t:basic -is:funny game:paper`, order: "edhrec", unique: "cards" });
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

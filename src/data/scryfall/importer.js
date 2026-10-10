// Lecture d'un fichier de collection (CSV ou JSON exporté par ManaBox, Moxfield, Delver Lens…).
// Pur : aucun accès réseau, testé dans tests/data/importer.test.js.

export function parseCSV(text) {
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
const NUMBER_KEYS = ["collector_number", "collector_no", "card_number", "number", "numero", "numéro"];
const LANG_KEYS = ["language", "lang", "langue"];
const FOIL_KEYS = ["foil", "finish", "is_foil"];
const COND_KEYS = ["condition", "etat", "état"];

const LANG_NAMES = {
  english: "en", french: "fr", "français": "fr", francais: "fr", german: "de", deutsch: "de", italian: "it", spanish: "es",
  portuguese: "pt", japanese: "ja", korean: "ko", russian: "ru", "chinese simplified": "zhs", "simplified chinese": "zhs",
  "chinese traditional": "zht", "traditional chinese": "zht", phyrexian: "ph",
  en: "en", fr: "fr", de: "de", it: "it", es: "es", sp: "es", pt: "pt", ja: "ja", jp: "ja", ko: "ko", ru: "ru", zhs: "zhs", zht: "zht", cs: "zhs", ct: "zht", ph: "ph",
};
/** « French », « FR », « fr »… → code Scryfall (« fr »), ou "" si inconnu. */
export const langCode = v => LANG_NAMES[String(v || "").trim().toLowerCase()] || "";
/** « foil », « etched », « true », « yes », « 1 » → foil ; « normal », « », « false »… → pas foil. */
export const isFoil = v => /^(foil|etched|true|yes|oui|1|f|x)$/i.test(String(v || "").trim());
const CONDS = { "near mint": "NM", mint: "NM", nm: "NM", m: "NM", "lightly played": "LP", excellent: "LP", ex: "LP", lp: "LP", sp: "LP",
  "moderately played": "MP", good: "MP", gd: "MP", mp: "MP", played: "MP", pl: "MP", "heavily played": "HP", hp: "HP", poor: "DMG", po: "DMG", damaged: "DMG", dmg: "DMG" };
/** « Near Mint », « NM », « Excellent »… → NM / LP / MP / HP / DMG (NM par défaut). */
export const conditionCode = v => CONDS[String(v || "").trim().toLowerCase()] || "NM";
function pick(row, keys, def = null) {
  const low = {};
  for (const [k, v] of Object.entries(row)) if (k) low[k.trim().toLowerCase().replace(/ /g, "_")] = v;
  for (const k of keys) if (low[k] !== undefined && String(low[k]).trim()) return String(low[k]).trim();
  return def;
}

/**
 * [{ name, quantity, set, number, lang, foil, condition }] depuis un CSV ou un JSON.
 * Les lignes identiques (même carte, impression, langue, finition, état) sont fusionnées ; les exemplaires différents restent séparés.
 */
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
    const number = (pick(row, NUMBER_KEYS, "") || "").replace(/^0+(?=\d)/, "");
    const lang = langCode(pick(row, LANG_KEYS, ""));
    const foil = isFoil(pick(row, FOIL_KEYS, ""));
    const condition = conditionCode(pick(row, COND_KEYS, ""));
    const k = [name.toLowerCase(), set, number, lang, foil, condition].join("|");
    if (merged.has(k)) merged.get(k).quantity += qty; else merged.set(k, { name, quantity: qty, set, number, lang, foil, condition });
  }
  return [...merged.values()];
}


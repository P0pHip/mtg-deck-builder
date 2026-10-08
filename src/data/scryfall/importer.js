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


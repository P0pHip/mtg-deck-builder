// Parcourir une extension : choix de l'extension, puis tout son catalogue en grille avec +/− pour ajouter vite.
import { setCatalog } from "../../data/scryfall/index.js";
import { browsableSets, fallbackIcon } from "../../data/scryfall/sets.js";
import * as collectionService from "../../services/collectionService.js";
import { $, cImgS, cName, esc, msg, norm, spin } from "../dom.js";
import { openSheet } from "../sheet.js";
import { state, t } from "../state.js";

const COLOR_KEYS = ["W", "U", "B", "R", "G", "C", "M"];
const RARITIES = ["C", "U", "R", "M"];
let sets = [], current = null, catalog = [], shown = [], changed = false, onClose = () => {};
const colors = new Set(), rarities = new Set();

const owned = () => Object.fromEntries(state.collection.map(c => [c.name, c.quantity]));

/** Même logique que le filtre de la collection (C = incolore, M = multicolore). */
function matchesColors(c) {
  if (!colors.size) return true;
  const id = c.color_identity || [];
  if (colors.has("C") && !id.length) return true;
  const wanted = [...colors].filter(k => "WUBRG".includes(k));
  if (colors.has("M") && id.length < 2) return false;
  if (colors.has("C") && !wanted.length && !colors.has("M")) return false;
  return wanted.every(k => id.includes(k));
}

export async function openSetBrowser({ onClosed } = {}) {
  onClose = onClosed || (() => {});
  changed = false;
  $("#setBrowser").hidden = false;
  document.body.classList.add("noscroll");
  if (current) return renderCatalog();
  renderPicker();
}

function close() {
  $("#setBrowser").hidden = true;
  document.body.classList.remove("noscroll");
  if (changed) onClose();
}

// ------------------------------------------------------------ étape 1 : choisir l'extension
async function renderPicker() {
  current = null;
  $("#sbTitle").textContent = t("browseSet");
  $("#sbBack").hidden = true;
  $("#sbBody").innerHTML = `<input type="search" id="sbSetQ" placeholder="${esc(t("setSearchPh"))}" autocomplete="off">
    <div class="msg" id="sbMsg"></div><div class="setlist" id="sbSets"></div>`;
  $("#sbSetQ").oninput = renderSetList;
  if (!sets.length) {
    msg($("#sbMsg"), spin(t("loadingSets")));
    try { sets = await browsableSets(); } catch (e) { msg($("#sbMsg"), t("netErr") + e.message, "err"); return; }
    msg($("#sbMsg"), sets.length ? "" : t("netErr"), sets.length ? "" : "err");
  }
  renderSetList();
}

function renderSetList() {
  const q = norm($("#sbSetQ").value.trim());
  const mine = {};
  for (const c of state.collection) if (c.set) mine[c.set] = (mine[c.set] || 0) + 1;
  const hits = sets.filter(s => !q || norm(s.name).includes(q) || s.code.toLowerCase() === q).slice(0, q ? 200 : 80);
  $("#sbSets").innerHTML = hits.map(s => `<button class="setrow" data-code="${esc(s.code)}">
      <img src="${esc(s.icon || fallbackIcon(s.code))}" alt="" onerror="this.style.visibility='hidden'">
      <span class="sn"><b>${esc(s.name)}</b><small>${esc(s.code.toUpperCase())} · ${esc((s.released || "").slice(0, 4))} · ${t("setCards")(s.count)}</small></span>
      ${mine[s.code] ? `<span class="free small">${t("inYourCol")(mine[s.code])}</span>` : ""}</button>`).join("")
    + (!q && sets.length > hits.length ? `<div class="muted small center">${t("setSearchMore")}</div>` : "");
  $("#sbSets").querySelectorAll(".setrow").forEach(b => b.onclick = () => pickSet(sets.find(s => s.code === b.dataset.code)));
}

// ------------------------------------------------------------ étape 2 : le catalogue
async function pickSet(set) {
  current = set;
  catalog = [];
  $("#sbTitle").innerHTML = `<img src="${esc(set.icon || fallbackIcon(set.code))}" alt="" class="sbicon"> ${esc(set.name)}`;
  $("#sbBack").hidden = false;
  $("#sbBody").innerHTML = `<div class="msg" id="sbMsg">${spin(t("loadingSet"))}</div>`;
  try {
    catalog = await setCatalog(set.code, { onProgress: (n, total) => msg($("#sbMsg"), spin(`${t("loadingSet")} ${n}/${total}`)) });
  } catch (e) { msg($("#sbMsg"), t("netErr") + e.message, "err"); return; }
  if (current !== set) return; // l'utilisateur a changé d'extension entre-temps
  renderCatalog();
}

function renderCatalog() {
  $("#sbBody").innerHTML = `
    <div class="sbfilters">
      <input type="search" id="sbQ" placeholder="${esc(t("filter"))}" autocomplete="off">
      <div class="colorfilter" id="sbColors"></div>
      <div class="colorfilter" id="sbRarity"></div>
      <label class="chk small"><input type="checkbox" id="sbMissing"> ${t("missingOnly")}</label>
    </div>
    <div class="row between small"><span id="sbStats" class="muted"></span><span class="msg" id="sbMsg"></span></div>
    <div class="setgrid" id="sbGrid"></div>`;
  const toggles = (el, keys, set, label) => {
    el.innerHTML = keys.map(k => `<button class="cf ${set.has(k) ? "on" : ""}" data-k="${k}" title="${esc(label(k))}">${
      k.length === 1 && "WUBRGCM".includes(k) && el.id === "sbColors" ? `<span class="pip ${k}">${k}</span>` : `<span class="rar ${k}">${k}</span>`}</button>`).join("");
    el.querySelectorAll("button").forEach(b => b.onclick = () => {
      set.has(b.dataset.k) ? set.delete(b.dataset.k) : set.add(b.dataset.k);
      toggles(el, keys, set, label); renderGrid();
    });
  };
  toggles($("#sbColors"), COLOR_KEYS, colors, k => (k === "C" ? t("colorless") : k === "M" ? t("multicolor") : k));
  toggles($("#sbRarity"), RARITIES, rarities, k => t("rarity")[k]);
  $("#sbQ").oninput = renderGrid;
  $("#sbMissing").onchange = renderGrid;
  renderGrid();
}

function renderGrid() {
  const have = owned();
  const q = norm($("#sbQ").value.trim());
  const missing = $("#sbMissing").checked;
  shown = catalog.filter(c => (!q || [c.name, c.fr?.name, c.type_line, c.fr?.type_line].some(x => norm(x).includes(q)))
    && matchesColors(c) && (!rarities.size || rarities.has(c.rarity)) && (!missing || !have[c.name]));
  const ownedCount = catalog.filter(c => have[c.name]).length;
  $("#sbStats").textContent = t("setOwned")(ownedCount, catalog.length) + (shown.length !== catalog.length ? ` · ${t("shownN")(shown.length)}` : "");
  $("#sbGrid").innerHTML = shown.map((c, i) => tile(c, i, have[c.name] || 0)).join("") || `<div class="empty">${t("noResult")}</div>`;
  $("#sbGrid").onclick = onGridClick;
}

const tile = (c, i, n) => `<div class="stile ${n ? "have" : ""}" data-i="${i}">
    <div class="simg">${cImgS(c) ? `<img loading="lazy" src="${esc(cImgS(c))}" alt="${esc(cName(c))}">` : `<div class="noimg">${esc(cName(c))}</div>`}
      ${n ? `<span class="cnt">×${n}</span>` : ""}<span class="rar ${c.rarity}">${c.rarity}</span></div>
    <div class="sname" title="${esc(cName(c))}">${esc(cName(c))}</div>
    <div class="sctl"><button class="qb" data-d="-1" ${n ? "" : "disabled"} aria-label="−">−</button><b>${n}</b><button class="qb" data-d="1" aria-label="+">+</button></div>
  </div>`;

async function onGridClick(e) {
  const el = e.target.closest(".stile");
  if (!el) return;
  const c = shown[el.dataset.i];
  const btn = e.target.closest(".qb");
  if (!btn) { if (e.target.closest(".simg")) openSheet(c); return; }
  btn.disabled = true;
  const delta = +btn.dataset.d;
  try {
    let qty;
    if (delta > 0) qty = await collectionService.addFromCatalog(c, 1);
    else {
      const cur = state.collection.find(x => x.name === c.name);
      if (!cur) return;
      qty = (await collectionService.changeQuantity(cur, -1)).quantity;
    }
    changed = true;
    // mise à jour locale (la collection complète est rechargée à la fermeture)
    const cur = state.collection.find(x => x.name === c.name);
    if (qty <= 0) state.collection = state.collection.filter(x => x.name !== c.name);
    else if (cur) cur.quantity = qty;
    else state.collection.push({ ...c, quantity: qty, reserved: [], free: qty });
    el.outerHTML = tile(c, el.dataset.i, qty);
    const have = owned();
    $("#sbStats").textContent = t("setOwned")(catalog.filter(x => have[x.name]).length, catalog.length) + (shown.length !== catalog.length ? ` · ${t("shownN")(shown.length)}` : "");
    msg($("#sbMsg"), delta > 0 ? t("added")(cName(c), qty) : "", "ok");
  } catch (e) {
    msg($("#sbMsg"), t("netErr") + e.message, "err");
    btn.disabled = false;
  }
}

export function initSetBrowser() {
  $("#sbClose").onclick = close;
  $("#sbBack").onclick = renderPicker;
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#setBrowser").hidden && $("#sheet").hidden) close(); });
}

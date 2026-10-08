// Onglet « Collection » : liste filtrable, +/−, ajout de cartes par recherche Scryfall.
import { category } from "../../core/cards.js";
import { prints, search } from "../../data/scryfall/index.js";
import { fallbackIcon, getSets } from "../../data/scryfall/sets.js";
import * as collectionService from "../../services/collectionService.js";
import { $, $$, cImgS, cName, cType, dfc, esc, msg, norm, pips, spin } from "../dom.js";
import { openSheet } from "../sheet.js";
import { openSetBrowser } from "./setBrowser.js";
import { onLangChange, state, t } from "../state.js";

const MAX_ROWS = 300; // au-delà, on demande d'affiner le filtre (fluidité sur téléphone)
const COLOR_KEYS = ["W", "U", "B", "R", "G", "C", "M"];
let rows = [];
const colFilter = new Set(), addFilter = new Set();

/** Rang de tri par couleur : W, U, B, R, G, puis multicolores, incolores, terrains. */
function colorRank(c) {
  const id = c.color_identity || [];
  if ((c.type_line || "").split("//")[0].includes("Land")) return 40;
  if (!id.length) return 30;
  if (id.length === 1) return "WUBRG".indexOf(id[0]);
  return 10 + id.length + "WUBRG".indexOf(id[0]) / 10;
}

/** La carte passe-t-elle le filtre de couleurs ? (C = incolore, M = multicolore ; plusieurs couleurs = toutes requises) */
function matchesColors(c, filter) {
  if (!filter.size) return true;
  const id = c.color_identity || [];
  if (filter.has("C") && !id.length) return true;
  const wanted = [...filter].filter(k => "WUBRG".includes(k));
  if (filter.has("M") && id.length < 2) return false;
  if (filter.has("C") && !wanted.length && !filter.has("M")) return false;
  return wanted.every(k => id.includes(k));
}

let sets = new Map(); // code → { name, icon }
const setLabel = c => sets.get(c.set)?.name || c.set_name || (c.set || "").toUpperCase();

/** Badge d'extension : logo officiel + code ; nom complet au survol (PC) ou à l'appui (téléphone). */
export function setBadge(code, name) {
  if (!code) return "";
  const info = sets.get(code), full = info?.name || name || code.toUpperCase();
  return `<span class="setbadge" data-full="${esc(full)}" title="${esc(full)} (${esc(code.toUpperCase())})">` +
    `<img src="${esc(info?.icon || fallbackIcon(code))}" alt="" onerror="this.remove()"><span>${esc(code.toUpperCase())}</span></span>`;
}

/** Appui sur un badge : affiche le nom complet quelques secondes. */
function bindSetBadges(root) {
  root.querySelectorAll(".setbadge").forEach(b => {
    b.onclick = e => {
      e.stopPropagation();
      const label = b.querySelector("span");
      label.textContent = b.dataset.full;
      b.classList.add("open");
      setTimeout(() => { label.textContent = b.title.match(/\(([^)]+)\)$/)?.[1] || ""; b.classList.remove("open"); }, 2500);
    };
  });
}

function renderColorButtons(el, filter, onChange) {
  el.innerHTML = COLOR_KEYS.map(k => `<button class="cf ${filter.has(k) ? "on" : ""}" data-c="${k}" title="${k === "C" ? t("colorless") : k === "M" ? t("multicolor") : k}">
    ${k === "M" ? '<span class="pip M">M</span>' : `<span class="pip ${k}">${k}</span>`}</button>`).join("");
  el.querySelectorAll("button").forEach(b => b.onclick = () => {
    filter.has(b.dataset.c) ? filter.delete(b.dataset.c) : filter.add(b.dataset.c);
    renderColorButtons(el, filter, onChange);
    onChange();
  });
}

function renderSetFilter() {
  const sel = $("#setFilter"), cur = sel.value;
  const sets = new Map();
  for (const c of state.collection) if (c.set) sets.set(c.set, setLabel(c));
  sel.innerHTML = `<option value="">${t("allSets")}</option>` +
    [...sets].sort((a, b) => a[1].localeCompare(b[1])).map(([code, label]) => `<option value="${esc(code)}">${esc(label)}</option>`).join("");
  sel.value = sets.has(cur) ? cur : "";
}

export async function refresh() {
  state.collection = await collectionService.loadWithReservations();
  renderSetFilter();
  render();
  if (!sets.size) {
    sets = await getSets(); // noms complets et logos des extensions (en arrière-plan)
    renderSetFilter();
    render();
  }
}

function render() {
  const col = state.collection;
  const total = col.reduce((a, c) => a + c.quantity, 0);
  const value = col.reduce((a, c) => a + (c.price_eur || 0) * c.quantity, 0);
  $("#colCount").textContent = col.length ? `${col.length} ${t("cards")} · ${total} ${t("copies")} · ${value.toFixed(0)} €` : "";
  $("#colEmpty").style.display = col.length ? "none" : "";
  $("#colEmpty").textContent = t("emptyCol");

  const q = norm($("#filter").value.trim());
  const sorters = {
    name: (a, b) => cName(a).localeCompare(cName(b)),
    cmc: (a, b) => a.cmc - b.cmc || cName(a).localeCompare(cName(b)),
    price: (a, b) => (b.price_eur || 0) - (a.price_eur || 0),
    rank: (a, b) => (a.edhrec_rank || 1e9) - (b.edhrec_rank || 1e9),
    qty: (a, b) => b.quantity - a.quantity,
    color: (a, b) => colorRank(a) - colorRank(b) || a.cmc - b.cmc || cName(a).localeCompare(cName(b)),
    set: (a, b) => setLabel(a).localeCompare(setLabel(b)) || cName(a).localeCompare(cName(b)),
  };
  const setSel = $("#setFilter").value;
  rows = col.filter(c => !q || [c.name, c.type_line, c.oracle_text, c.fr?.name, c.fr?.text, c.fr?.type_line].some(x => norm(x).includes(q)))
    .filter(c => matchesColors(c, colFilter) && (!setSel || c.set === setSel))
    .sort(sorters[$("#sortBy").value] || sorters.name);

  $("#colList").innerHTML = rows.slice(0, MAX_ROWS).map((c, i) => `<div class="crow" data-i="${i}">
      ${cImgS(c) ? `<img loading="lazy" src="${cImgS(c)}" alt="">` : '<div class="noimg"></div>'}
      <div class="ci"><b>${esc(cName(c))}${dfc(c)}</b><small>${pips(c.mana_cost)} ${esc(cType(c))}</small>
        <small>${setBadge(c.set, c.set_name)} ${c.price_eur != null ? c.price_eur + " € · " : ""}${t("cat")[category(c)]}${c.reserved?.length ? ` · <span class="res">${c.reserved.map(r => `${r.count}× ${esc(r.name)}`).join(", ")}</span>` : ""}</small></div>
      <div class="qty"><button class="qb" data-d="-1" aria-label="−">−</button><b style="color:${c.free > 0 ? "var(--txt)" : "var(--red)"}">${c.quantity}</b><button class="qb" data-d="1" aria-label="+">+</button></div>
    </div>`).join("") + (rows.length > MAX_ROWS ? `<div class="empty">${t("refine300")(rows.length)}</div>` : "");

  bindSetBadges($("#colList"));
  $$("#colList .crow").forEach(row => {
    const c = rows[row.dataset.i];
    row.querySelector(".ci").onclick = () => openSheet(c);
    row.querySelector("img, .noimg").onclick = () => openSheet(c);
    row.querySelectorAll(".qb").forEach(b => b.onclick = () => changeQty(c, +b.dataset.d));
  });
}

async function changeQty(c, delta) {
  const r = await collectionService.changeQuantity(c, delta);
  msg($("#colMsg"), r.overflow ? "⚠ " + t("qtyWarn")(cName(c), r.reserved, r.quantity) : "", r.overflow ? "err" : "");
  if (r.quantity <= 0) state.collection = state.collection.filter(x => x !== c);
  else { c.quantity = r.quantity; c.free = r.quantity - r.reserved; }
  render();
}

// ------------------------------------------------------------ recherche / ajout
let timer = null, seq = 0;
async function runSearch(q) {
  const my = ++seq;
  msg($("#addMsg"), spin(t("searching")));
  let results;
  try { results = await search(q, state.lang, 16, { colors: [...addFilter], order: $("#addOrder").value }); }
  catch (e) { msg($("#addMsg"), t("netErr") + e.message, "err"); return; }
  if (my !== seq) return; // une recherche plus récente est partie
  const owned = Object.fromEntries(state.collection.map(c => [c.name, c.quantity]));
  const label = r => (state.lang === "fr" && r.printed_name ? r.printed_name : r.name);
  msg($("#addMsg"), results.length ? "" : t("noResult"));
  $("#addResults").innerHTML = results.map((r, i) => `<div class="res-card">${r.image_small ? `<img src="${r.image_small}" alt="">` : ""}
    <div class="ci"><b>${esc(label(r))}</b><small>${esc(r.type_line)}</small>
      <small>${setBadge(r.set, r.set_name)} ${esc(r.set_name || "")}${owned[r.name] ? ` · <span class="free">${t("owned")(owned[r.name])}</span>` : ""}</small></div>
    <div class="addctl"><select class="small setpick" id="as${i}" data-i="${i}" aria-label="${esc(t("printing"))}">
        <option value="${esc(r.set)}">${esc(r.set_name || r.set.toUpperCase())}</option></select>
      <div class="row"><input type="number" min="1" value="1" inputmode="numeric" id="aq${i}" aria-label="qty"><button class="btn small" data-add="${i}">${t("add")}</button></div></div></div>`).join("");
  bindSetBadges($("#addResults"));
  // liste des extensions chargée à la demande (au premier appui sur le menu)
  $$("#addResults .setpick").forEach(sel => {
    const load = async () => {
      if (sel.dataset.loaded) return;
      sel.dataset.loaded = "1";
      const r = results[sel.dataset.i];
      sel.innerHTML = `<option>${esc(t("loadingPrints"))}</option>`;
      let list = [];
      try { list = await prints(r.name); } catch { /* garde l'extension par défaut */ }
      if (!list.length) list = [{ set: r.set, set_name: r.set_name }];
      sel.innerHTML = list.map(p => `<option value="${esc(p.set)}" data-name="${esc(p.set_name)}">${esc(p.set_name)} (${esc(p.set.toUpperCase())}${p.released_at ? ", " + p.released_at.slice(0, 4) : ""})</option>`).join("");
      sel.value = list.some(p => p.set === r.set) ? r.set : list[0].set;
    };
    sel.addEventListener("pointerdown", load, { once: true });
    sel.addEventListener("focus", load, { once: true });
  });
  $$("#addResults .res-card img").forEach((img, i) => { img.onclick = () => openSheet({ ...results[i], oracle_text: "" }); });
  $$("#addResults [data-add]").forEach(b => b.onclick = async () => {
    const r = results[b.dataset.add], qty = Math.max(1, +$("#aq" + b.dataset.add).value || 1);
    b.disabled = true;
    try {
      const sel = $("#as" + b.dataset.add), opt = sel.selectedOptions[0];
      const set = sel.value || r.set, setName = opt?.dataset.name || r.set_name;
      const total = await collectionService.addCard(r.name, qty, set, setName);
      msg($("#addMsg"), t("added")(label(r), total), "ok");
      await refresh();
    } catch (e) {
      msg($("#addMsg"), t("netErr") + (e.message === "not-found" ? t("notFoundCard") : e.message), "err");
    }
    b.disabled = false;
  });
}

export function init() {
  $("#filter").oninput = render;
  $("#sortBy").onchange = render;
  $("#setFilter").onchange = render;
  renderColorButtons($("#colColors"), colFilter, render);
  const rerunSearch = () => { const q = $("#addSearch").value.trim(); if (q.length >= 2) runSearch(q); };
  renderColorButtons($("#addColors"), addFilter, rerunSearch);
  $("#addOrder").onchange = rerunSearch;
  $("#browseSet").onclick = () => openSetBrowser({ onClosed: refresh });
  $("#addSearch").oninput = () => {
    clearTimeout(timer);
    const q = $("#addSearch").value.trim();
    if (q.length < 2) { $("#addResults").innerHTML = ""; msg($("#addMsg"), ""); return; }
    timer = setTimeout(() => runSearch(q), 450);
  };
  onLangChange(() => {
    $("#filter").placeholder = t("filter");
    $("#addSearch").placeholder = t("addPh");
    renderSetFilter();
    renderColorButtons($("#colColors"), colFilter, render);
    renderColorButtons($("#addColors"), addFilter, rerunSearch);
    render();
  });
}

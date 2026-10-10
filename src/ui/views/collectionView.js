// Onglet « Collection » : liste filtrable, +/−, ajout de cartes par recherche Scryfall.
import { TYPE_ORDER, category, mainType } from "../../core/cards.js";
import { cardValue, copiesOf, hasFoil, qtyInSet, setsOf, valueInSet } from "../../core/copies.js";
import { prints, search } from "../../data/scryfall/index.js";
import { fallbackIcon, getSets } from "../../data/scryfall/sets.js";
import * as collectionService from "../../services/collectionService.js";
import * as statsService from "../../services/statsService.js";
import * as wishlistService from "../../services/wishlistService.js";
import { $, $$, cImgS, cName, cType, dfc, esc, msg, norm, pips, spin } from "../dom.js";
import { openSheet } from "../sheet.js";
import { openScanner } from "./scanner.js";
import { openSetBrowser } from "./setBrowser.js";
import { openStats } from "./statsView.js";
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
const setNameOf = (code, name) => sets.get(code)?.name || name || code.toUpperCase();

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
  // toutes les extensions dont on a au moins un exemplaire
  for (const c of state.collection) for (const cp of copiesOf(c)) if (cp.set) sets.set(cp.set, sets.get(cp.set) || setNameOf(cp.set, cp.set_name));
  sel.innerHTML = `<option value="">${t("allSets")}</option>` +
    [...sets].sort((a, b) => a[1].localeCompare(b[1])).map(([code, label]) => `<option value="${esc(code)}">${esc(label)}</option>`).join("");
  sel.value = sets.has(cur) ? cur : "";
}

export async function refresh() {
  state.collection = await collectionService.loadWithReservations();
  statsService.recordToday(state.collection).catch(() => {}); // un relevé de valeur par jour
  renderSetFilter();
  render();
  if (!sets.size) {
    sets = await getSets(); // noms complets et logos des extensions (en arrière-plan)
    renderSetFilter();
    render();
  }
}

// ------------------------------------------------------------ dossiers (classement) et affichage
const pref = {
  get: (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* sans stockage */ } },
};
let view = pref.get("colView", "list"), group = pref.get("colGroup", "none"), folder = null;

const COLOR_FOLDERS = ["W", "U", "B", "R", "G", "M", "C", "L"];
/** Dossier « couleur » d'une carte : W/U/B/R/G, M (multicolore), C (incolore), L (terrain). */
function colorKey(c) {
  if ((c.type_line || "").split("//")[0].includes("Land")) return "L";
  const id = c.color_identity || [];
  return !id.length ? "C" : id.length > 1 ? "M" : id[0];
}

/** Classements possibles : clés de dossier d'une carte, nom, icône et ordre des dossiers. */
const GROUPS = {
  set: {
    // une carte compte dans chaque extension dont on a un exemplaire ; sans extension connue : dossier « ? »
    keys: c => (setsOf(c).length ? setsOf(c) : ["?"]),
    copies: (c, k) => (k === "?" ? c.quantity : qtyInSet(c, k)),
    value: (c, k) => (k === "?" ? cardValue(c) : valueInSet(c, k)),
    label: k => sets.get(k)?.name || state.collection.find(c => c.set === k)?.set_name || k.toUpperCase(),
    icon: k => `<img class="ficon" src="${esc(sets.get(k)?.icon || fallbackIcon(k))}" alt="" onerror="this.remove()">`,
    order: (a, b) => (sets.get(b)?.released || "").localeCompare(sets.get(a)?.released || "") || a.localeCompare(b),
    // complétion : cartes différentes possédées dans cette impression / cartes numérotées de l'extension
    extra: f => {
      const s = sets.get(f.key), size = s?.printed || s?.count;
      if (!size) return "";
      const pct = Math.min(100, Math.round(f.cards / size * 100));
      return `<div class="fprog" title="${esc(t("setCompletion")(f.cards, size))}"><i style="width:${pct}%"></i></div>
        <small class="muted">${t("setCompletion")(Math.min(f.cards, size), size)} · ${pct} %</small>`;
    },
  },
  color: {
    keys: c => [colorKey(c)],
    label: k => ({ M: t("multicolor"), C: t("colorless"), L: t("types").Land }[k] || t("colorNames")[k]),
    icon: k => (k === "L" ? "🏔️" : `<span class="pip ${k}">${k === "M" ? "M" : k}</span>`),
    order: (a, b) => COLOR_FOLDERS.indexOf(a) - COLOR_FOLDERS.indexOf(b),
  },
  type: {
    keys: c => [mainType(c.type_line)],
    label: k => t("types")[k] || k,
    icon: k => TYPE_ICONS[k] || "✦",
    order: (a, b) => [...TYPE_ORDER, "Other"].indexOf(a) - [...TYPE_ORDER, "Other"].indexOf(b),
  },
  deck: {
    // une carte peut être rangée dans plusieurs decks ; les exemplaires libres vont dans « Hors decks »
    keys: c => [...(c.reserved || []).map(r => r.id), ...(c.free > 0 ? ["_free"] : [])],
    label: k => (k === "_free" ? t("freeFolder") : state.collection.flatMap(c => c.reserved || []).find(r => r.id === k)?.name || "?"),
    icon: k => (k === "_free" ? "📂" : "🗂️"),
    order: (a, b) => (a === "_free") - (b === "_free"),
    copies: (c, k) => (k === "_free" ? c.free : (c.reserved || []).find(r => r.id === k)?.count || 0),
  },
};
const TYPE_ICONS = { Creature: "🐉", Planeswalker: "🧙", Battle: "⚔️", Instant: "⚡", Sorcery: "🔮", Artifact: "⚙️", Enchantment: "✨", Land: "🏔️" };

function render() {
  const col = state.collection;
  const total = col.reduce((a, c) => a + c.quantity, 0);
  const value = col.reduce((a, c) => a + cardValue(c), 0); // chaque exemplaire à son prix (foil compris)
  $("#colCount").textContent = col.length ? `${col.length} ${t("cards")} · ${total} ${t("copies")} · ${value.toFixed(0)} €` : "";
  $("#colEmpty").style.display = col.length ? "none" : "";
  $("#colEmpty").textContent = t("emptyCol");
  $("#colGroup").value = group;
  $$("#colView button").forEach(b => b.classList.toggle("on", b.dataset.v === view));

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
    .filter(c => matchesColors(c, colFilter) && (!setSel || setsOf(c).includes(setSel)))
    .sort(sorters[$("#sortBy").value] || sorters.name);

  const g = GROUPS[group];
  if (g && folder === null) return renderFolders(g);
  $("#colFolders").innerHTML = "";
  if (g) {
    rows = rows.filter(c => g.keys(c).includes(folder));
    $("#colCrumb").innerHTML = `<button class="btn small ghost" id="crumbBack">← ${esc(t("folders"))}</button>
      <span class="ctitle">${g.icon(folder)} <b>${esc(g.label(folder))}</b> <small class="muted">${rows.length} ${t("cards")}</small></span>`;
    $("#crumbBack").onclick = () => { folder = null; render(); };
    // extension : compléter depuis son catalogue (seulement les cartes qui manquent)
    if (group === "set" && sets.has(folder)) {
      $("#colCrumb").insertAdjacentHTML("beforeend", `<button class="btn small ghost" id="crumbMissing">${t("seeMissing")}</button>`);
      $("#crumbMissing").onclick = () => openSetBrowser({ onClosed: refresh, code: folder, missing: true });
    }
  } else $("#colCrumb").innerHTML = "";

  const shown = rows.slice(0, MAX_ROWS);
  const more = rows.length > MAX_ROWS ? `<div class="empty">${t("refine300")(rows.length)}</div>` : "";
  const list = $("#colList");
  list.className = view === "tiles" ? "setgrid" : "clist";
  list.innerHTML = (view === "tiles" ? shown.map(tile) : shown.map(listRow)).join("") + more;

  bindSetBadges(list);
  list.querySelectorAll("[data-i]").forEach(el => {
    const c = rows[el.dataset.i];
    el.querySelectorAll(":scope > img, :scope > .noimg, .ci, .simg").forEach(x => { x.onclick = () => openSheet(c); });
    el.querySelectorAll(".qb").forEach(b => b.onclick = () => changeQty(c, +b.dataset.d));
  });
}

const qtyColor = c => (c.free > 0 ? "var(--txt)" : "var(--red)");

const listRow = (c, i) => `<div class="crow" data-i="${i}">
    ${cImgS(c) ? `<img loading="lazy" src="${cImgS(c)}" alt="">` : '<div class="noimg"></div>'}
    <div class="ci"><b>${esc(cName(c))}${dfc(c)}${hasFoil(c) ? '<span class="foilmark" title="foil">✨</span>' : ""}</b><small>${pips(c.mana_cost)} ${esc(cType(c))}</small>
      <small>${setBadge(c.set, c.set_name)}${setsOf(c).length > 1 ? ` <span class="muted">+${setsOf(c).length - 1}</span>` : ""} ${c.price_eur != null ? c.price_eur + " € · " : ""}${t("cat")[category(c)]}${c.reserved?.length ? ` · <span class="res">${c.reserved.map(r => `${r.count}× ${esc(r.name)}`).join(", ")}</span>` : ""}</small></div>
    <div class="qty"><button class="qb" data-d="-1" aria-label="−">−</button><b style="color:${qtyColor(c)}">${c.quantity}</b><button class="qb" data-d="1" aria-label="+">+</button></div>
  </div>`;

const tile = (c, i) => `<div class="stile have" data-i="${i}">
    <div class="simg">${cImgS(c) ? `<img loading="lazy" src="${esc(cImgS(c))}" alt="${esc(cName(c))}">` : `<div class="noimg">${esc(cName(c))}</div>`}
      ${c.reserved?.length ? `<span class="lock" title="${esc(c.reserved.map(r => `${r.count}× ${r.name}`).join(", "))}">🔒${c.reserved.reduce((a, r) => a + r.count, 0)}</span>` : ""}</div>
    <div class="sname" title="${esc(cName(c))}">${hasFoil(c) ? "✨ " : ""}${esc(cName(c))}</div>
    <div class="sctl"><button class="qb" data-d="-1" aria-label="−">−</button><b style="color:${qtyColor(c)}">${c.quantity}</b><button class="qb" data-d="1" aria-label="+">+</button></div>
  </div>`;

/** Grille de dossiers (extensions, couleurs, types ou decks), avec un aperçu des plus belles cartes. */
function renderFolders(g) {
  $("#colCrumb").innerHTML = "";
  $("#colList").innerHTML = "";
  const folders = new Map();
  for (const c of rows) {
    for (const k of g.keys(c)) {
      const f = folders.get(k) || { key: k, cards: 0, copies: 0, value: 0, top: [] };
      const n = g.copies ? g.copies(c, k) : c.quantity;
      f.cards++; f.copies += n;
      f.value += g.value ? g.value(c, k) : cardValue(c) / Math.max(1, c.quantity) * n;
      f.top.push(c);
      folders.set(k, f);
    }
  }
  const list = [...folders.values()].sort((a, b) => g.order(a.key, b.key));
  $("#colFolders").innerHTML = list.map(f => {
    const covers = f.top.filter(cImgS).sort((a, b) => (b.price_eur || 0) - (a.price_eur || 0)).slice(0, 3);
    return `<button class="folder" data-k="${esc(f.key)}">
      <div class="fcover">${covers.map((c, i) => `<img loading="lazy" src="${esc(cImgS(c))}" alt="" style="--i:${[1, 0, 2][i]}">`).join("")}</div>
      <div class="fname">${g.icon(f.key)} <b>${esc(g.label(f.key))}</b></div>
      <small class="muted">${f.cards} ${t("cards")} · ${f.copies} ${t("copies")} · ${f.value.toFixed(0)} €</small>${g.extra?.(f) || ""}</button>`;
  }).join("") || (state.collection.length ? `<div class="empty">${t("noResult")}</div>` : "");
  $$("#colFolders .folder").forEach(b => b.onclick = () => { folder = b.dataset.k; render(); window.scrollTo({ top: $("#colCount").getBoundingClientRect().top + scrollY - 70 }); });
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
  $("#addResults").innerHTML = results.map((r, i) => `<div class="res-card" data-i="${i}">${r.image_small ? `<img src="${r.image_small}" alt="">` : ""}
    <div class="ci"><b>${esc(label(r))}</b><small>${esc(r.type_line)}</small>
      <small>${setBadge(r.set, r.set_name)} ${esc(r.set_name || "")}${owned[r.name] ? ` · <span class="free">${t("owned")(owned[r.name])}</span>` : ""}</small></div>
    <div class="addctl"><select class="small setpick" id="as${i}" data-i="${i}" aria-label="${esc(t("printing"))}">
        <option value="${esc(r.set)}">${esc(r.set_name || r.set.toUpperCase())}</option></select>
      <div class="row"><input type="number" min="1" value="1" inputmode="numeric" id="aq${i}" aria-label="qty"><button class="cpfoil" data-foil="${i}" title="${esc(t("cpFoil"))}" aria-pressed="false">✨</button><button class="btn small" data-add="${i}">${t("add")}</button><button class="qb" data-wish="${i}" title="${esc(t("wishAddOne"))}" aria-label="${esc(t("wishAddOne"))}">⭐</button></div></div></div>`).join("");
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
  $$("#addResults .res-card img").forEach(img => { img.onclick = () => openSheet(results[img.closest(".res-card").dataset.i].card); });
  $$("#addResults [data-foil]").forEach(b => b.onclick = () => { b.classList.toggle("on"); b.setAttribute("aria-pressed", b.classList.contains("on")); });
  $$("#addResults [data-wish]").forEach(b => b.onclick = async () => {
    await wishlistService.addWishes([{ card: results[b.dataset.wish].card, count: 1 }]);
    b.textContent = "✓"; b.disabled = true;
  });
  $$("#addResults [data-add]").forEach(b => b.onclick = async () => {
    const r = results[b.dataset.add], qty = Math.max(1, +$("#aq" + b.dataset.add).value || 1);
    b.disabled = true;
    try {
      const sel = $("#as" + b.dataset.add), opt = sel.selectedOptions[0];
      const set = sel.value || r.set, setName = opt?.dataset.name || r.set_name;
      const foil = $(`#addResults [data-foil="${b.dataset.add}"]`).classList.contains("on");
      // résultat en français (recherche FR) : l'exemplaire est noté en français
      const total = await collectionService.addCard(r.name, qty, set, setName, r.card, { foil, lang: r.printed_name ? "fr" : "" });
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
  $("#colGroup").onchange = () => { group = $("#colGroup").value; folder = null; pref.set("colGroup", group); render(); };
  $$("#colView button").forEach(b => b.onclick = () => { view = b.dataset.v; pref.set("colView", view); render(); });
  renderColorButtons($("#colColors"), colFilter, render);
  const rerunSearch = () => { const q = $("#addSearch").value.trim(); if (q.length >= 2) runSearch(q); };
  renderColorButtons($("#addColors"), addFilter, rerunSearch);
  $("#addOrder").onchange = rerunSearch;
  $("#browseSet").onclick = () => openSetBrowser({ onClosed: refresh });
  $("#statsBtn").onclick = () => openStats({ onPricesUpdated: refresh });
  // exemplaires modifiés depuis la fiche d'une carte : on recharge (quantités, réservations)
  document.addEventListener("collection-changed", () => refresh());
  $("#scanBtn").onclick = () => openScanner({ onClosed: refresh });
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

// Decks préconstruits (Commander, decks de démarrage…) : choisir un deck, voir son contenu, l'ajouter d'un coup.
import { BASIC_NAMES, category } from "../../core/cards.js";
import { preconList } from "../../data/mtgjson.js";
import { fallbackIcon, getSets } from "../../data/scryfall/sets.js";
import * as preconService from "../../services/preconService.js";
import { $, $$, cImg, cImgS, cName, copyText, esc, msg, norm, spin } from "../dom.js";
import { openSheet } from "../sheet.js";
import { state, t } from "../state.js";

const KINDS = ["commander", "starter", "other", "all"];
let decks = [], sets = new Map(), added = {}, kind = "commander", current = null, changed = false;
let order = "new", year = "";
let onClose = () => {}, showDecks = () => {};

export async function openPrecons({ onClosed, onShowDecks } = {}) {
  onClose = onClosed || (() => {});
  showDecks = onShowDecks || (() => {});
  changed = false;
  $("#precons").hidden = false;
  document.body.classList.add("noscroll");
  added = await preconService.addedPrecons().catch(() => ({}));
  if (current) return renderDeck();
  renderPicker();
}

function close() {
  $("#precons").hidden = true;
  document.body.classList.remove("noscroll");
  if (changed) onClose();
}

// ------------------------------------------------------------ étape 1 : choisir le deck
async function renderPicker() {
  current = null;
  $("#pcTitle").textContent = t("preconTitle");
  $("#pcBack").hidden = true;
  $("#pcBody").innerHTML = `<input type="search" id="pcQ" placeholder="${esc(t("preconSearchPh"))}" autocomplete="off">
    <div class="seg pckinds" id="pcKinds">${KINDS.map(k => `<button data-k="${k}">${t("preconKinds")[k]}</button>`).join("")}</div>
    <div class="row pcsort"><select class="small" id="pcOrder">${["new", "old", "name"].map(k => `<option value="${k}">${t("preconOrder")[k]}</option>`).join("")}</select>
      <select class="small" id="pcYear"></select></div>
    <div class="msg" id="pcMsg"></div><div class="setlist" id="pcList"></div>`;
  $("#pcQ").oninput = renderList;
  $("#pcOrder").value = order;
  $("#pcOrder").onchange = () => { order = $("#pcOrder").value; renderList(); };
  $("#pcYear").onchange = () => { year = $("#pcYear").value; renderList(); };
  $$("#pcKinds button").forEach(b => b.onclick = () => { kind = b.dataset.k; renderList(); });
  if (!decks.length) {
    msg($("#pcMsg"), spin(t("preconLoadingList")));
    try {
      [decks, sets] = await Promise.all([preconList(), getSets().catch(() => new Map())]);
    } catch (e) { msg($("#pcMsg"), t("netErr") + e.message, "err"); return; }
    msg($("#pcMsg"), "");
  }
  renderList();
}

function renderList() {
  $$("#pcKinds button").forEach(b => b.classList.toggle("on", b.dataset.k === kind));
  const q = norm($("#pcQ").value.trim());
  const setName = d => sets.get(d.set)?.name || d.set.toUpperCase();
  const ofKind = decks.filter(d => kind === "all" || d.kind === kind);
  // années proposées : celles où il existe des decks de la catégorie choisie
  const years = [...new Set(ofKind.map(d => d.released.slice(0, 4)).filter(Boolean))].sort().reverse();
  if (year && !years.includes(year)) year = "";
  $("#pcYear").innerHTML = `<option value="">${t("preconAllYears")}</option>` + years.map(y => `<option value="${y}">${y}</option>`).join("");
  $("#pcYear").value = year;
  const sorters = {
    new: (a, b) => b.released.localeCompare(a.released) || a.name.localeCompare(b.name),
    old: (a, b) => a.released.localeCompare(b.released) || a.name.localeCompare(b.name),
    name: (a, b) => a.name.localeCompare(b.name),
  };
  const hits = ofKind.filter(d => (!year || d.released.startsWith(year))
    && (!q || norm(d.name).includes(q) || norm(setName(d)).includes(q) || d.set === q)).sort(sorters[order]);
  const shown = hits.slice(0, q || year ? 300 : 120);
  $("#pcList").innerHTML = shown.map(d => `<button class="setrow" data-file="${esc(d.file)}">
      <img src="${esc(sets.get(d.set)?.icon || fallbackIcon(d.set))}" alt="" onerror="this.style.visibility='hidden'">
      <span class="sn"><b>${esc(d.name)}</b><small>${esc(setName(d))} · ${esc(d.released.slice(0, 4))} · ${esc(t("preconTypes")[d.type] || d.type)}</small></span>
      ${added[d.file] ? `<span class="free small">${t("preconAdded")}</span>` : ""}</button>`).join("")
    + (hits.length > shown.length ? `<div class="muted small center">${t("preconMore")}</div>` : "")
    + (!hits.length && decks.length ? `<div class="empty">${t("noResult")}</div>` : "");
  $$("#pcList .setrow").forEach(b => b.onclick = () => pickDeck(decks.find(d => d.file === b.dataset.file)));
}

// ------------------------------------------------------------ étape 2 : le contenu du deck
async function pickDeck(d) {
  current = { meta: d, precon: null };
  const mine = current;
  $("#pcTitle").innerHTML = `<img src="${esc(sets.get(d.set)?.icon || fallbackIcon(d.set))}" alt="" class="sbicon"> ${esc(d.name)}`;
  $("#pcBack").hidden = false;
  $("#pcBody").innerHTML = `<div class="msg" id="pcMsg">${spin(t("preconLoading"))}</div>`;
  try {
    mine.precon = await preconService.loadPrecon(d.file, { onProgress: (n, total) => msg($("#pcMsg"), spin(`${t("preconLoading")} ${n}/${total}`)) });
  } catch (e) { if (current === mine) msg($("#pcMsg"), t("netErr") + (e.message === "not-found" ? t("noResult") : e.message), "err"); return; }
  if (current !== mine) return; // un autre deck a été choisi entre-temps
  renderDeck();
}

const BOARD_ORDER = { commander: 0, main: 1, side: 2 };
const CAT_ORDER = ["creature", "ramp", "draw", "removal", "wipe", "other", "land"];

function renderDeck() {
  const p = current.precon, d = current.meta;
  if (!p) return pickDeck(d);
  const owned = Object.fromEntries(state.collection.map(c => [c.name, c.quantity]));
  const hasSide = p.cards.some(x => x.board === "side");
  const isCmd = !!p.commander;
  const cards = [...p.cards].sort((a, b) => BOARD_ORDER[a.board] - BOARD_ORDER[b.board]
    || CAT_ORDER.indexOf(category(a.card)) - CAT_ORDER.indexOf(category(b.card)) || a.card.cmc - b.card.cmc || cName(a.card).localeCompare(cName(b.card)));
  const commanders = p.cards.filter(x => x.board === "commander");
  const main = p.cards.filter(x => x.board !== "side");
  const total = main.reduce((a, x) => a + x.count, 0);
  const value = main.reduce((a, x) => a + (x.card.price_eur || 0) * x.count, 0);
  const nonBasic = main.filter(x => !BASIC_NAMES.has(x.card.name));
  const have = nonBasic.filter(x => owned[x.card.name] >= 1).length;

  $("#pcBody").innerHTML = `
    <div class="pchead">
      ${commanders.length ? `<div class="pcfaces">${commanders.map(x => cImg(x.card) ? `<img src="${esc(cImg(x.card))}" alt="${esc(cName(x.card))}" data-name="${esc(x.card.name)}">` : "").join("")}</div>` : ""}
      <div class="pcinfo">
        <div class="muted small">${esc(t("preconTypes")[d.type] || d.type)} · ${esc(sets.get(d.set)?.name || d.set.toUpperCase())} · ${esc(d.released)}</div>
        <div class="stats">
          <div class="stat"><b>${total}</b><span>${t("stCards")}</span></div>
          <div class="stat"><b>${value.toFixed(0)} €</b><span>${t("stValue")}</span></div>
          <div class="stat"><b>${have}/${nonBasic.length}</b><span>${t("preconOwned")}</span></div>
        </div>
        <label class="chk"><input type="checkbox" id="pcBasics"><span>${t("preconBasics")}</span></label>
        ${hasSide ? `<label class="chk"><input type="checkbox" id="pcSide"><span>${t("preconSide")}</span></label>` : ""}
        <label class="chk"><input type="checkbox" id="pcSave" ${isCmd ? "checked" : ""}><span>${t("preconSave")}</span></label>
        <button class="btn full" id="pcAdd"></button>
        <div class="msg" id="pcMsg"></div>
        ${have < nonBasic.length ? `<button class="btn small ghost full" id="pcMissing">${t("preconCopyMissing")(nonBasic.length - have)}</button>` : ""}
      </div>
    </div>
    <div class="setgrid" id="pcGrid">${cards.map((x, i) => {
      const n = owned[x.card.name] || 0;
      return `<div class="stile ${n ? "have" : ""}" data-i="${i}">
        <div class="simg">${cImgS(x.card) ? `<img loading="lazy" src="${esc(cImgS(x.card))}" alt="${esc(cName(x.card))}">` : `<div class="noimg">${esc(cName(x.card))}</div>`}
          <span class="cnt">×${x.count}</span>${x.board !== "main" ? `<span class="rar S" title="${esc(t("preconBoards")[x.board])}">${x.board === "commander" ? "★" : "R"}</span>` : ""}</div>
        <div class="sname" title="${esc(cName(x.card))}">${esc(cName(x.card))}</div>
        <small class="${n ? "free" : "muted"}">${n ? t("owned")(n) : t("preconNotOwned")}</small></div>`;
    }).join("")}</div>`;

  const updateBtn = () => {
    const n = preconService.preconLines(p, { basics: $("#pcBasics").checked, side: !!$("#pcSide")?.checked }).reduce((a, x) => a + x.count, 0);
    $("#pcAdd").textContent = t("preconAddBtn")(n);
  };
  $("#pcBasics").onchange = updateBtn;
  if (hasSide) $("#pcSide").onchange = updateBtn;
  updateBtn();
  $("#pcAdd").onclick = addDeck;
  if ($("#pcMissing")) $("#pcMissing").onclick = async () => {
    await copyText(nonBasic.filter(x => !owned[x.card.name]).map(x => `${x.count} ${x.card.name}`).join("\n"));
    $("#pcMissing").textContent = t("copied");
  };
  $$("#pcGrid .stile").forEach(el => { el.querySelector(".simg").onclick = () => openSheet(cards[el.dataset.i].card); });
  $$(".pcfaces img").forEach(img => { img.onclick = () => openSheet(p.cards.find(x => x.card.name === img.dataset.name)?.card); });
}

async function addDeck() {
  const btn = $("#pcAdd"), p = current.precon;
  btn.disabled = true;
  msg($("#pcMsg"), spin(t("preconAdding")));
  try {
    const r = await preconService.addPrecon(p, { basics: $("#pcBasics").checked, side: !!$("#pcSide")?.checked, saveDeck: $("#pcSave").checked });
    added[p.file] = true;
    await onClose(); // recharge la collection : les cartes ajoutées apparaissent comme possédées
    renderDeck();
    msg($("#pcMsg"), t("preconDone")(r.copies, r.cards) + (r.deck ? `<br>${t("preconSaved")(esc(r.deck.name))} <button class="btn small ghost" id="pcSeeDeck">${t("preconSeeDeck")}</button>` : ""), "ok");
    if (r.deck) $("#pcSeeDeck").onclick = () => { close(); showDecks(); };
    $("#pcAdd").textContent = t("preconAgain");
    $("#pcSave").checked = false; // évite d'enregistrer deux fois le même deck
  } catch (e) {
    msg($("#pcMsg"), t("netErr") + e.message, "err");
    btn.disabled = false;
  }
}

export function initPrecons() {
  $("#pcClose").onclick = close;
  $("#pcBack").onclick = renderPicker;
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#precons").hidden && $("#sheet").hidden) close(); });
}

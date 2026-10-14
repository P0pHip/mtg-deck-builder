// Importer une decklist (Moxfield, Archidekt, Arena, MTGO…) : ce que j'ai, ce qui manque, puis enregistrement dans « Mes decks ».
import { BASIC_NAMES, deckFromList } from "../../core/index.js";
import * as decklistService from "../../services/decklistService.js";
import { bindDeckGrid, deckGridHtml, sortDeckCards } from "../deckGrid.js";
import { $, cImg, cName, copyText, esc, msg, spin } from "../dom.js";
import { bindWishButton } from "./wishlistView.js";
import { openSheet } from "../sheet.js";
import { state, t } from "../state.js";

const FORMATS = ["commander", "standard", "pioneer", "modern", "legacy", "pauper"];
let draft = "", imp = null, onChanged = async () => {}, openDeck = () => {}, showDecks = () => {};
let sharedName = null; // deck reçu par lien : son nom, en attendant l'analyse

/** `shared` : deck reçu par lien ({ name, text }) — analysé tout de suite. */
export function openDeckImport({ onSaved, onOpenDeck, onShowDecks, shared = null } = {}) {
  onChanged = onSaved || (async () => {});
  openDeck = onOpenDeck || (() => {});
  showDecks = onShowDecks || (() => {});
  $("#deckImport").hidden = false;
  document.body.classList.add("noscroll");
  if (shared) { draft = shared.text; sharedName = shared.name; renderPaste(); analyze(); return; }
  sharedName = null; // ouvert à la main : ce n'est plus le deck reçu par lien (même si son analyse avait échoué)
  imp ? renderResult() : renderPaste();
}

function close() {
  $("#deckImport").hidden = true;
  document.body.classList.remove("noscroll");
}

// ------------------------------------------------------------ étape 1 : coller la liste
function renderPaste() {
  imp = null;
  $("#diTitle").textContent = t("diTitle");
  $("#diBack").hidden = true;
  $("#diBody").innerHTML = `<p class="muted small">${t("diHelp")}</p>
    <textarea id="diText" rows="14" spellcheck="false" placeholder="${esc(t("diPh"))}"></textarea>
    <div class="row wrap gap"><label class="btn ghost filebtn"><span>${t("diFile")}</span><input type="file" id="diFile" accept=".txt,.dec,.csv,text/plain" hidden></label>
      <button class="btn grow" id="diGo">${t("diAnalyze")}</button></div>
    <div class="msg" id="diMsg"></div>`;
  $("#diText").value = draft;
  $("#diText").oninput = () => { draft = $("#diText").value; };
  $("#diFile").onchange = async () => {
    const f = $("#diFile").files[0];
    if (f) { draft = await f.text(); $("#diText").value = draft; }
    $("#diFile").value = "";
  };
  $("#diGo").onclick = analyze;
  $("#diText").focus();
}

async function analyze() {
  if (!draft.trim()) { msg($("#diMsg"), t("diEmpty"), "err"); return; }
  $("#diGo").disabled = true;
  msg($("#diMsg"), spin(t("diLooking")));
  try {
    imp = await decklistService.importDecklist(draft, { lang: state.lang, onProgress: (n, total) => msg($("#diMsg"), spin(`${t("diLooking")} ${n}/${total}`)) });
    imp.free = await decklistService.freeCopies();
    if (sharedName !== null) { imp.shared = true; imp.name ||= sharedName; sharedName = null; }
    renderResult();
  } catch (e) {
    msg($("#diMsg"), t("netErr") + (e.message === "no-cards" ? t("diNoCards") : e.message), "err");
    $("#diGo").disabled = false;
  }
}

// ------------------------------------------------------------ étape 2 : ce que j'ai, ce qui manque
/** État d'une ligne dans la collection : exemplaires libres, rangés dans un autre deck, à acheter. */
function lineState(x) {
  if (BASIC_NAMES.has(x.card.name)) return { need: 0, free: x.count, missing: 0, basic: true };
  const free = Math.max(0, imp.free[x.card.name] || 0);
  const col = state.collection.find(c => c.name === x.card.name);
  return { need: x.count, free: Math.min(free, x.count), missing: Math.max(0, x.count - free), reserved: col?.reserved || [] };
}

function renderResult() {
  $("#diTitle").textContent = imp.name || t("diTitle");
  $("#diBack").hidden = false;
  const cards = sortDeckCards(imp.cards);
  const main = imp.cards.filter(x => x.board !== "side");
  const states = main.map(x => ({ x, s: lineState(x) })).filter(o => !o.s.basic);
  const total = main.reduce((a, x) => a + x.count, 0);
  const value = main.reduce((a, x) => a + (x.card.price_eur || 0) * x.count, 0);
  const need = states.reduce((a, o) => a + o.s.need, 0), have = states.reduce((a, o) => a + o.s.free, 0);
  const missing = states.filter(o => o.s.missing);
  const buyCost = missing.reduce((a, o) => a + (o.x.card.price_eur || 0) * o.s.missing, 0);
  const choices = decklistService.commanderChoices(imp), mates = decklistService.partnerChoices(imp);
  const auto = deckFromList(decklistService.mainList(imp), { commander: imp.commander, partner: imp.partner }).format;
  const commanders = imp.cards.filter(x => x.board === "commander");

  $("#diBody").innerHTML = `${imp.shared ? `<p class="msg ok">🔗 ${t("diShared")}</p>` : ""}
    <div class="pchead">
      ${commanders.length ? `<div class="pcfaces">${commanders.map(x => cImg(x.card) ? `<img src="${esc(cImg(x.card))}" alt="${esc(cName(x.card))}" data-name="${esc(x.card.name)}">` : "").join("")}</div>` : ""}
      <div class="pcinfo">
        <input type="text" id="diName" value="${esc(imp.name || (imp.commander ? cName(imp.commander) : ""))}" placeholder="${esc(t("deckNamePh"))}">
        <div class="row wrap diopts">
          ${choices.length ? `<label class="small muted">${t("diCommander")}<select class="small" id="diCmd"><option value="">${t("diNoCommander")}</option>
            ${choices.map(x => `<option value="${esc(x.card.name)}" ${imp.commander?.name === x.card.name ? "selected" : ""}>${esc(cName(x.card))}</option>`).join("")}</select></label>` : ""}
          ${mates.length ? `<label class="small muted">${t("diPartner")}<select class="small" id="diPartner"><option value="">${t("diNoPartner")}</option>
            ${mates.map(x => `<option value="${esc(x.card.name)}" ${imp.partner?.name === x.card.name ? "selected" : ""}>${esc(cName(x.card))}</option>`).join("")}</select></label>` : ""}
          <label class="small muted">${t("diFormat")}<select class="small" id="diFmt">${FORMATS.filter(f => f !== "commander" || imp.commander)
            .map(f => `<option value="${f}" ${f === auto ? "selected" : ""}>${esc(t("fmt")[f][0])}${f === auto ? ` (${t("diAuto")})` : ""}</option>`).join("")}</select></label>
        </div>
        <div class="stats">
          <div class="stat"><b>${total}</b><span>${t("stCards")}</span></div>
          <div class="stat"><b>${value.toFixed(0)} €</b><span>${t("stValue")}</span></div>
          <div class="stat"><b>${have}/${need}</b><span>${t("diHave")}</span></div>
          <div class="stat"><b>${missing.reduce((a, o) => a + o.s.missing, 0)} · ${buyCost.toFixed(0)} €</b><span>${t("stBuy")}</span></div>
        </div>
        ${imp.notFound.length ? `<div class="warn">${t("diNotFound")(imp.notFound.length)} ${esc(imp.notFound.join(", "))}</div>` : ""}
        ${imp.ignored.length ? `<div class="muted small">${t("diIgnored")(imp.ignored.length)} ${esc(imp.ignored.slice(0, 5).join(" · "))}${imp.ignored.length > 5 ? "…" : ""}</div>` : ""}
        ${missing.length ? `<label class="chk"><input type="checkbox" id="diComplete"><span>${t("diComplete")}</span></label>` : ""}
        <button class="btn full" id="diSave">${t("diSave")}</button>
        <div class="msg" id="diMsg"></div>
        ${missing.length ? `<div class="row wrap"><button class="btn small ghost grow" id="diMissing">${t("preconCopyMissing")(missing.length)}</button>
          <button class="btn small ghost grow" id="diWish">${t("wishAddMissing")}</button></div>` : ""}
      </div>
    </div>
    <div class="setgrid" id="diGrid">${deckGridHtml(cards, x => {
      const s = lineState(x);
      if (s.basic) return { have: true, cls: "muted", label: t("diBasic") };
      if (!s.missing) return { have: true, cls: "free", label: t("diFreeN")(s.free) };
      if (s.free) return { have: true, cls: "free", label: t("diPartial")(s.free, s.need) };
      if (s.reserved.length) return { have: false, cls: "res", label: t("diInDeck")(esc(s.reserved[0].name)) };
      return { have: false, cls: "buyl", label: t("diToBuy") };
    })}</div>`;

  bindDeckGrid($("#diGrid"), cards);
  $("#diBody").querySelectorAll(".pcfaces img").forEach(img => { img.onclick = () => openSheet(imp.cards.find(x => x.card.name === img.dataset.name)?.card); });
  if ($("#diCmd")) $("#diCmd").onchange = () => { decklistService.setCommander(imp, $("#diCmd").value || null); renderResult(); };
  if ($("#diPartner")) $("#diPartner").onchange = () => { decklistService.setPartner(imp, $("#diPartner").value || null); renderResult(); };
  if ($("#diMissing")) $("#diMissing").onclick = async () => {
    await copyText(missing.map(o => `${o.s.missing} ${o.x.card.name}`).join("\n"));
    $("#diMissing").textContent = t("copied");
  };
  if ($("#diWish")) bindWishButton($("#diWish"), () => missing.map(o => ({ card: o.x.card, count: o.s.missing })), imp.name || imp.commander?.name || "");
  $("#diSave").onclick = save;
}

async function save() {
  const btn = $("#diSave");
  btn.disabled = true;
  msg($("#diMsg"), spin(t("diSaving")));
  try {
    const fmt = $("#diFmt").value;
    const r = await decklistService.saveImported(imp, { name: $("#diName").value.trim(), format: fmt, complete: !!$("#diComplete")?.checked });
    await onChanged();
    imp.free = await decklistService.freeCopies();
    imp.name = r.deck.name;
    renderResult(); // les cartes ajoutées / réservées changent d'état
    msg($("#diMsg"), `${t("diSaved")(esc(r.deck.name))}${r.added ? ` ${t("diAdded")(r.added)}` : ""}<br>
      <button class="btn small" id="diOpen">${t("diOpenBuild")}</button> <button class="btn small ghost" id="diSee">${t("preconSeeDeck")}</button>`, "ok");
    $("#diOpen").onclick = () => { close(); openDeck(r.deck); };
    $("#diSee").onclick = () => { close(); showDecks(); };
    $("#diSave").textContent = t("diSaveAgain");
  } catch (e) {
    msg($("#diMsg"), t("netErr") + e.message, "err");
    btn.disabled = false;
  }
}

export function initDeckImport() {
  $("#diClose").onclick = close;
  $("#diBack").onclick = renderPaste;
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#deckImport").hidden && $("#sheet").hidden) close(); });
}

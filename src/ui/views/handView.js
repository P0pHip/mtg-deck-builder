// Main de départ (onglet « Construire ») : probabilités de terrains, tirage d'essai avec mulligan et pioche,
// et test « solitaire » (jouer seul les premiers tours, plus un bilan de centaines de parties jouées automatiquement).
import * as core from "../../core/index.js";
import { $, $$, cImgS, cName, cNameOf, esc, msg } from "../dom.js";
import { openSheet } from "../sheet.js";
import { state, t } from "../state.js";

let deck = null, lib = [], hand = [], drawn = 0, mulligans = 0, bottom = new Set();
let gf = null; // partie solitaire en cours
const pct = p => `${Math.round(p * 100)} %`; // espace insécable : « 75 % » ne se coupe pas
const num = n => n.toLocaleString(state.lang); // 3,6 en français

/** Nouveau deck affiché : probabilités recalculées, main effacée. */
export function renderHand(d) {
  deck = d;
  hand = []; mulligans = 0; bottom = new Set();
  const odds = core.landOdds(deck);
  const sum = (a, b) => odds.slice(a, b + 1).reduce((x, y) => x + y, 0);
  const lands = core.landsIn(core.library(deck)), size = core.library(deck).length;
  $("#handOdds").innerHTML = `
    <div class="small muted">${t("handLands")(lands, size)}</div>
    <div class="hodds">${odds.map((p, k) => `<div title="${esc(t("handExactly")(k, pct(p)))}"><i style="height:${Math.max(2, p * 100 / Math.max(...odds) * 0.85)}%"></i><b>${p >= 0.005 ? pct(p) : ""}</b>${k}</div>`).join("")}</div>
    <div class="small">${t("handKeepable")(pct(sum(2, 4)))} · <span class="muted">${t("handFlood")(pct(sum(0, 1)), pct(sum(5, 7)))}</span></div>
    <div class="small muted">${t("handOnCurve")([2, 3, 4].map(n => `T${n} ${pct(core.onCurveOdds(deck, n))}`).join(" · "))}</div>
    ${goldfishSummary()}`;
  gf = null; renderGf();
  $("#hand").innerHTML = "";
  $("#handInfo").textContent = "";
  $("#handMull").disabled = $("#handDraw").disabled = true;
}

function deal(isMulligan) {
  mulligans = isMulligan ? mulligans + 1 : 0;
  lib = core.shuffle(core.library(deck));
  hand = lib.slice(0, 7); drawn = 7; bottom = new Set();
  draw();
}

/** Affichage de la main ; après un mulligan (règle de Londres), on touche les cartes à remettre sous la bibliothèque. */
function draw() {
  const kept = hand.filter((_, i) => !bottom.has(i));
  $("#hand").innerHTML = hand.map((c, i) => `<button class="hcard ${bottom.has(i) ? "out" : ""} ${i >= 7 ? "new" : ""}" data-i="${i}" title="${esc(cName(c))}">
    ${cImgS(c) ? `<img src="${esc(cImgS(c))}" alt="${esc(cName(c))}">` : `<span>${esc(cName(c))}</span>`}</button>`).join("");
  const toBottom = Math.max(0, mulligans - bottom.size);
  $("#handInfo").innerHTML = `${t("handInHand")(core.landsIn(kept), kept.length - core.landsIn(kept))}`
    + (mulligans ? ` · <b>${t("handMulligan")(mulligans)}</b>${toBottom ? ` — ${t("handBottom")(toBottom)}` : ""}` : "")
    + (drawn > 7 ? ` · ${t("handTurn")(drawn - 7 + 1)}` : "");
  $("#handMull").disabled = false;
  $("#handDraw").disabled = drawn >= lib.length;
  $$("#hand .hcard").forEach(b => b.onclick = () => {
    const i = +b.dataset.i;
    // après un mulligan, un appui choisit les cartes à mettre en dessous ; sinon, il ouvre la fiche
    if (mulligans && i < 7 && (bottom.has(i) || bottom.size < mulligans)) { bottom.has(i) ? bottom.delete(i) : bottom.add(i); draw(); }
    else openSheet(hand[i]);
  });
}

// ------------------------------------------------------------ test solitaire
/** Bilan de parties jouées seul automatiquement : mana utilisé par tour, terrains posés, sortie du commandant. */
function goldfishSummary() {
  if (core.library(deck).length < 12) return "";
  const r = core.goldfishStats(deck, { games: 300, turns: 5 });
  const late = r.turns.slice(0, 4).filter(x => x.landDrop < 0.8).map(x => `T${x.turn}`);
  return `<div class="gfstats"><div class="small"><b>🎲 ${t("gfStatsTitle")}</b> <span class="muted">${t("gfStatsHow")}</span></div>
    <div class="gfbars">${r.turns.map(x => `<div title="${esc(t("gfBarTip")(x.turn, num(x.spent), num(x.mana), pct(x.landDrop)))}">
      <i style="height:${Math.min(100, x.mana * 14)}%"><i style="height:${x.mana ? x.spent / x.mana * 100 : 0}%"></i></i><b>${num(x.spent)}/${num(x.mana)}</b>T${x.turn}</div>`).join("")}</div>
    <div class="small muted">${t("gfLegend")}${late.length ? ` · <span class="warnc">${t("gfLate")(late.join(", "))}</span>` : ""}
      ${r.commander ? ` · ${r.commander.avgTurn ? t("gfCmdAvg")(num(r.commander.avgTurn), pct(r.commander.share)) : t("gfCmdNever")}` : ""}</div></div>`;
}

function renderGf() {
  const el = $("#gf");
  if (!gf) { el.innerHTML = ""; return; }
  const s = gf, lands = s.battlefield.filter(p => core.isLandCard(p.card)).length;
  const others = s.battlefield.filter(p => !core.isLandCard(p.card));
  const img = (c, attrs = "") => `<button class="hcard" ${attrs} title="${esc(cName(c))}">${cImgS(c) ? `<img src="${esc(cImgS(c))}" alt="${esc(cName(c))}">` : `<span>${esc(cName(c))}</span>`}</button>`;
  el.innerHTML = `<div class="gfhead"><b>${t("gfTurn")(s.turn)}</b> · ${t("gfMana")(s.mana, s.manaTotal)} · <span class="muted">${t("gfLib")(s.library.length)}</span></div>
    <div class="glabel">${t("gfBattlefield")(lands)}</div>
    <div class="hand gfbf">${others.map(p => img(p.card)).join("") || `<span class="muted small">${t("gfEmpty")}</span>`}</div>
    <div class="glabel">${t("gfHand")}</div>
    <div class="hand">${s.hand.map((c, i) => img(c, `data-i="${i}"`)).join("")}</div>
    <div class="row wrap gap">${s.commander && !s.commanderCasts ? `<button class="btn small" id="gfCmd">👑 ${t("gfCmd")(core.commanderCost(s))}</button>` : ""}
      ${s.partner && !s.partnerCasts ? `<button class="btn small" id="gfPartner">👑 ${t("gfPartner")(esc(cName(s.partner)), core.commanderCost(s, "partner"))}</button>` : ""}
      <button class="btn small" id="gfNext">⏭ ${t("gfNext")}</button><button class="btn small ghost" id="gfAuto">🤖 ${t("gfAuto")}</button>
      <button class="btn small ghost" id="gfStop">✕ ${t("gfStop")}</button></div>
    <div class="msg" id="gfMsg"></div>
    <div class="gflog small muted">${s.log.map(l => `<div><b>T${l.turn}</b> : ${l.plays.length ? l.plays.map(n => esc(cNameOf(n))).join(", ") : "—"}${l.spent ? ` <span>(${t("gfSpent")(l.spent)})</span>` : ""}</div>`).join("")}</div>`;
  const act = r => { if (r.error) { msg($("#gfMsg"), t("gfErr")[r.error], "err"); return; } gf = r.state; renderGf(); };
  $$("#gf [data-i]").forEach(b => b.onclick = () => act(core.play(gf, +b.dataset.i)));
  if ($("#gfCmd")) $("#gfCmd").onclick = () => act(core.play(gf, "commander"));
  if ($("#gfPartner")) $("#gfPartner").onclick = () => act(core.play(gf, "partner"));
  $("#gfNext").onclick = () => { gf = core.nextTurn(gf); renderGf(); };
  $("#gfAuto").onclick = () => { gf = core.autoTurn(gf); renderGf(); };
  $("#gfStop").onclick = () => { gf = null; renderGf(); };
}

export function initHand() {
  $("#gfStart").onclick = () => { if (deck) { gf = core.newGoldfish(deck); renderGf(); $("#gf").scrollIntoView({ block: "nearest", behavior: "smooth" }); } };
  $("#handNew").onclick = () => deal(false);
  $("#handMull").onclick = () => deal(true);
  $("#handDraw").onclick = () => { if (drawn < lib.length) { hand.push(lib[drawn++]); draw(); } };
}

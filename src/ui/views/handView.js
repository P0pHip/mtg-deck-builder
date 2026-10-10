// Main de départ (onglet « Construire ») : probabilités de terrains, et tirage d'essai avec mulligan et pioche.
import * as core from "../../core/index.js";
import { $, $$, cImgS, cName, esc } from "../dom.js";
import { openSheet } from "../sheet.js";
import { t } from "../state.js";

let deck = null, lib = [], hand = [], drawn = 0, mulligans = 0, bottom = new Set();
const pct = p => `${Math.round(p * 100)} %`; // espace insécable : « 75 % » ne se coupe pas

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
    <div class="small muted">${t("handOnCurve")([2, 3, 4].map(n => `T${n} ${pct(core.onCurveOdds(deck, n))}`).join(" · "))}</div>`;
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

export function initHand() {
  $("#handNew").onclick = () => deal(false);
  $("#handMull").onclick = () => deal(true);
  $("#handDraw").onclick = () => { if (drawn < lib.length) { hand.push(lib[drawn++]); draw(); } };
}

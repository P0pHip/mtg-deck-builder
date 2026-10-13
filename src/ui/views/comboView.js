// « ♾️ Combos » (onglet Construire) : combos du deck d'après Commander Spellbook, et ceux à une carte près.
// La recherche (réseau) ne se fait qu'à l'appui sur le bouton ; ensuite, chaque modification du deck reclasse les combos sur place.
import { classifyCombos, comboUrl, commandZone } from "../../core/index.js";
import * as deckService from "../../services/deckService.js";
import { $, $$, cNameOf, esc, msg, spin } from "../dom.js";
import { state, t } from "../state.js";
import { editDeck } from "./buildView.js";

const SHOW = 15;
let variants = null, searchedFor = null; // résultats de la dernière recherche, et les cartes du deck à ce moment-là

const deckNames = deck => new Set([...deck.cards.map(c => c.name), ...commandZone(deck).map(c => c.name)]);

/** Exemplaires libres d'une carte dans la collection (nom complet ou face avant). */
function owned(name) {
  const front = name.split(" // ")[0];
  const c = state.collection.find(x => x.name === name || x.name.split(" // ")[0] === front);
  return c ? c.free ?? c.quantity ?? 0 : 0;
}

/**
 * Appelé à chaque affichage du deck : reclasse les combos déjà trouvés, ou les oublie si c'est un autre deck
 * (moins de 70 % de cartes en commun avec celui de la recherche).
 */
export function refreshCombos() {
  if (!variants || !state.deck) return;
  const now = deckNames(state.deck);
  const common = [...searchedFor].filter(n => now.has(n)).length;
  if (common < 0.7 * Math.max(searchedFor.size, now.size)) { resetCombos(); return; }
  render();
}

export function resetCombos() {
  variants = null; searchedFor = null;
  $("#comboBox").innerHTML = "";
}

async function search() {
  const box = $("#comboBox");
  if (!state.deck) return;
  box.innerHTML = `<div class="msg">${spin(t("comboLooking"))}</div>`;
  try {
    variants = await deckService.deckCombos(state.deck);
    searchedFor = deckNames(state.deck);
    render();
  } catch (e) {
    variants = null;
    msg(box, t("comboErr")(esc(e.message)), "err");
  }
}

function comboHtml(v, almost) {
  const cards = v.cards.map(n => (almost && n === v.missing ? `<span class="cmiss">${esc(cNameOf(n))}</span>` : esc(cNameOf(n)))).join(" + ");
  const tag = almost ? (v.owned
    ? `<span class="badge part" title="${esc(t("comboOwnedTip"))}">✓ ${t("comboOwned")}</span>`
    : `<span class="badge buy">🛒 ${t("comboBuy")}</span>`) : "";
  const lines = (label, text) => (text ? `<div class="clabel">${label}</div><div class="ctext">${esc(text).replace(/\n/g, "<br>")}</div>` : "");
  return `<details class="combo"><summary><span class="ccards">${cards}</span> ${tag}
      <small class="muted">→ ${esc(v.produces.slice(0, 3).join(", "))}</small></summary>
    ${lines(t("comboNeeds"), v.requires.join("\n"))}${lines(t("comboMana"), v.mana)}
    ${lines(t("comboPrereq"), v.prerequisites)}${lines(t("comboSteps"), v.description)}
    <div class="row wrap gap">${almost && v.owned ? `<button class="btn small" data-add="${esc(v.missing)}">${t("comboAdd")(esc(cNameOf(v.missing)))}</button>` : ""}
      <a class="btn small ghost" href="${comboUrl(v.id)}" target="_blank" rel="noopener">${t("comboLink")}</a></div></details>`;
}

function render() {
  const { complete, almost } = classifyCombos(variants, state.deck, { owned, format: state.deck.format });
  const list = (items, isAlmost) => items.slice(0, SHOW).map(v => comboHtml(v, isAlmost)).join("")
    + (items.length > SHOW ? `<div class="muted small">${t("comboMore")(items.length - SHOW)}</div>` : "");
  $("#comboBox").innerHTML = `<div class="combos"><div class="muted small">${t("comboSource")}</div>
    ${!complete.length && !almost.length ? `<div class="msg">${t("comboNone")}</div>` : ""}
    ${complete.length ? `<h3>${t("comboIn")(complete.length)}</h3>${list(complete, false)}` : ""}
    ${almost.length ? `<h3>${t("comboAlmost")(almost.length)}</h3>${list(almost, true)}` : ""}
    <div class="row wrap gap"><button class="btn small ghost" id="comboClose">${t("comboClose")}</button></div></div>`;
  $$("#comboBox [data-add]").forEach(b => b.onclick = () => editDeck({ add: [{ name: b.dataset.add, count: 1 }] }));
  $("#comboClose").onclick = resetCombos;
}

export function initCombos() {
  $("#comboBtn").onclick = search;
}

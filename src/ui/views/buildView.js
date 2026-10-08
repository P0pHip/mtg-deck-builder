// Onglet « Construire » : paramètres, génération, affichage et édition du deck, enregistrement.
import { TYPE_ORDER, commanders, mainType } from "../../core/index.js";
import * as decksRepo from "../../data/decksRepo.js";
import * as deckService from "../../services/deckService.js";
import {
  $, $$, armButton, cBack, cImg, cImgS, cName, cNameOf, cText, cType, copyText, dfc, esc, identityPips, msg, norm, pips, spin,
} from "../dom.js";
import { openSheet } from "../sheet.js";
import { onLangChange, state, t } from "../state.js";
import * as aiView from "./aiView.js";

let cmdList = [], pool = [];
let refreshAll = async () => {}; // fourni par main.js (recharge collection + decks)

// ------------------------------------------------------------ paramètres
function renderFmtHelp() {
  const f = $("#fmt").value, all = t("fmt"), [name, desc] = all[f];
  const others = Object.entries(all).filter(([k]) => k !== f).map(([, [n, d]]) => `<div><b>${n}</b> — ${d}</div>`).join("");
  $("#fmtHelp").innerHTML = `<b style="color:var(--gold2)">${name}</b> — ${desc}${f !== "commander" ? `<br><small>${t("fmtCommon")}</small>` : ""}
    <div class="other">${others}</div>`;
}

export async function loadCommanders() {
  cmdList = commanders(state.collection);
  renderCommanders();
}
function renderCommanders() {
  const cur = $("#cmd").value;
  $("#cmd").innerHTML = `<option value="">${t("bestCmd")}</option>` + cmdList.map(c =>
    `<option value="${esc(c.name)}">${esc(cName(c))} (${(c.color_identity || []).join("") || "C"})${c.reserved?.length ? " 🔒" : ""}</option>`).join("");
  $("#cmd").value = cur;
}

const currentParams = () => ({
  format: $("#fmt").value, commander: $("#cmd").value, colors: $$("#colors input:checked").map(i => i.value),
  use_reserved: $("#useRes").checked, include_external: $("#useExt").checked, wish: $("#wish").value.trim(),
});

// ------------------------------------------------------------ génération
async function build(body, fresh) {
  const m = $("#buildMsg"), btn = $("#go");
  btn.disabled = true;
  msg(m, spin(t("building")));
  await new Promise(r => setTimeout(r, 30)); // laisse le temps d'afficher le spinner
  if (fresh) { state.currentDeckId = null; state.currentDeckName = ""; }
  state.lastBody = body;
  try {
    const { deck, suggestion } = await deckService.generate(body, {
      deckId: state.currentDeckId, onStep: s => s === "external" && msg(m, spin(t("fetchingExt"))),
    });
    renderSuggestion(suggestion);
    if (!deck) throw new Error(t("cannotBuild"));
    setDeck(deck);
    msg(m, ""); msg($("#saveMsg"), ""); msg($("#editMsg"), "");
    $("#deckName").value = state.currentDeckName || deckService.defaultDeckName(deck, cName);
    renderSaveButtons();
    $("#result").scrollIntoView({ behavior: "smooth" });
  } catch (e) {
    msg(m, e.message === "empty-collection" ? t("importFirst") : e.message, "err");
  }
  btn.disabled = false;
}

/** Affiche un deck (nouveau ou rouvert) et réinitialise l'assistant IA. */
export function setDeck(deck, { id = null, name = null } = {}) {
  state.deck = deck;
  if (id !== null) { state.currentDeckId = id; state.currentDeckName = name; $("#deckName").value = name; renderSaveButtons(); }
  aiView.onNewDeck();
  renderDeck();
}

function renderSuggestion(sg) {
  state.lastSuggestion = sg || null;
  if (!sg) { $("#suggest").innerHTML = ""; return; }
  $("#suggest").innerHTML = `<div class="suggest"><b>${t("suggestTitle")(sg.score_gain, sg.total_gain)}</b>
    <ul>${sg.cards.map(c => `<li>${c.count}× ${esc(cNameOf(c.name))} — ${t("inDeck")} ${c.decks.map(d => "« " + esc(d.name) + " »").join(", ")}</li>`).join("")}</ul>
    <div class="small" style="opacity:.85;margin-bottom:8px">${t("suggestWhy")}</div>
    <button class="btn small full" id="useAnyway">${t("useAnyway")}</button>
    ${sg.decks.map(([id, name]) => `<button class="btn small danger full" data-break="${id}">${t("breakDeck")(esc(name))}</button>`).join("")}</div>`;
  $("#useAnyway").onclick = () => { $("#useRes").checked = true; build({ ...state.lastBody, use_reserved: true }, false); };
  $$("#suggest [data-break]").forEach(b => armBreak(b, () => build({ ...state.lastBody }, false)));
}

/** Bouton « éclater » : supprime le deck enregistré et libère ses cartes. */
export function armBreak(btn, after) {
  armButton(btn, async () => {
    const d = await decksRepo.deleteDeck(btn.dataset.break);
    if (btn.dataset.break === state.currentDeckId) { state.currentDeckId = null; state.currentDeckName = ""; renderSaveButtons(); }
    const n = d ? Object.values(decksRepo.deckCards(d.deck)).reduce((a, b) => a + b, 0) : 0;
    const text = t("broken")(d?.name || "?", n);
    msg($("#buildMsg"), text, "ok"); msg($("#decksFlash"), text, "ok");
    await refreshAll();
    if (after) after();
  }, () => t("confirm"));
}

// ------------------------------------------------------------ affichage du deck
function warnText(w) {
  if (typeof w === "string") return w;
  const fn = t("warn")[w.k];
  return fn ? fn(w) : JSON.stringify(w);
}
const buyBadge = x => (!x.missing ? "" : x.owned ? `<span class="badge part">${x.owned}/${x.count}</span>` : '<span class="badge buy">🛒</span>');

export function renderDeck() {
  const deck = state.deck;
  if (!deck) return;
  $("#result").style.display = "block";
  $("#stats").innerHTML = [
    [deck.total + (deck.commander ? 1 : 0), t("stCards")], [deck.avg_cmc, t("stCmc")], [identityPips(deck.identity), t("stId")],
    [Math.min(100, deck.score * 100).toFixed(0) + "/100", t("stScore")], [deck.value_eur + " €", t("stValue")],
    ...(deck.to_buy?.length ? [[`${deck.to_buy.reduce((a, b) => a + b.count, 0)} · ${deck.buy_cost} €`, t("stBuy")]] : []),
    [deck.themes?.length ? deck.themes.join(", ") : "–", t("stThemes")],
  ].map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join("");

  const w = deck.wish;
  $("#warnings").innerHTML = (w ? `<div class="wishbox">🎯 <b>${t("yourWish")}</b> « ${esc(w.text)} »<br>
      <span class="tags">${w.matched.length ? t("understood") + " " + w.matched.map(x => `<span>${esc(x)}</span>`).join("") + ` — ${t("fit")(Math.round(w.fit * 100))}` : t("notUnderstood")}</span></div>` : "") +
    (deck.warnings || []).map(x => `<div class="warn">⚠ ${esc(warnText(x))}</div>`).join("") +
    (deck.borrowed?.length ? `<div class="borrowed">🔁 ${t("borrowedMsg")} ${deck.borrowed.map(b => `${b.count}× ${esc(cNameOf(b.name))} (${b.decks.map(d => "« " + esc(d.name) + " »").join(", ")})`).join(" · ")}</div>` : "");

  // compteur bien visible : vert si le deck est complet, orange sinon
  const n = deck.total + (deck.commander ? 1 : 0), want = deck.format === "commander" ? 100 : 60;
  $("#deckCount").textContent = `${n}/${want}`;
  $("#deckCount").className = "deckcount " + (n === want ? "ok" : n > want && deck.format !== "commander" ? "ok" : "warn");
  $("#deckCount").title = t("deckCountTip")(n, want);

  const c = deck.commander;
  $("#cmdBox").innerHTML = c ? `<div class="card cmdbox"><div class="faces">${[cImg(c), cBack(c)].filter(Boolean).map(u => `<img src="${u}" alt="">`).join("")}</div>
     <div><h2>${esc(cName(c))}</h2><div>${pips(c.mana_cost)}</div><p>${esc(cText(c))}</p></div></div>` : "";
  if (c) $("#cmdBox .faces").onclick = () => openSheet(c);

  const byType = state.groupBy === "type";
  const key = byType ? x => mainType(x.type_line) : x => x.category;
  const order = byType ? [...TYPE_ORDER, "Other"] : ["creature", "ramp", "draw", "removal", "wipe", "other", "land"];
  const labels = byType ? t("types") : t("cat");
  const groups = {};
  deck.cards.forEach(x => (groups[key(x)] ||= []).push(x));
  Object.values(groups).forEach(l => l.sort((a, b) => a.cmc - b.cmc || cName(a).localeCompare(cName(b))));
  $("#list").innerHTML = order.filter(k => groups[k]).map(k => {
    const n = groups[k].reduce((a, x) => a + x.count, 0);
    return `<h3>${labels[k]} (${n})</h3><ul>${groups[k].map((x, i) => `<li data-k="${k}" data-i="${i}" class="${x.missing ? (x.owned ? "partial" : "buy") : ""}">
      <span class="n">${x.count}</span><span class="nm">${esc(cName(x))}${dfc(x)}${x.wish ? '<span class="star">★</span>' : ""}${buyBadge(x)}</span>
      <span class="mc">${pips(x.mana_cost)}</span>
      <span class="qbs"><button class="qb" data-d="-1" aria-label="−">−</button><button class="qb" data-d="1" aria-label="+">+</button></span></li>`).join("")}</ul>`;
  }).join("");
  $$("#list li").forEach(li => {
    const x = groups[li.dataset.k][li.dataset.i];
    li.querySelector(".nm").onclick = () => openSheet(x);
    li.querySelectorAll(".qb").forEach(b => b.onclick = () =>
      editDeck(+b.dataset.d > 0 ? { add: [{ name: x.name, count: 1 }] } : { remove: [{ name: x.name, count: 1 }] }));
  });
  $("#legend").innerHTML = deck.to_buy?.length
    ? `<span><i style="background:var(--buy)"></i>${t("legendBuy")}</span><span><i style="border:1px dashed var(--buy)"></i>${t("legendPartial")}</span>` : "";

  renderShop();
  const max = Math.max(...Object.values(deck.curve), 1);
  $("#curve").innerHTML = Object.entries(deck.curve).map(([k, v]) => `<div>${v || ""}<i style="height:${v / max * 85}%"></i>${k === "7" ? "7+" : k}</div>`).join("");
  const types = deck.types || {}, tmax = Math.max(...Object.values(types), 1);
  $("#types").innerHTML = [...TYPE_ORDER, "Other"].filter(k => types[k]).map(k =>
    `<div class="tr"><span>${t("types")[k]}</span><div class="bar"><i style="width:${types[k] / tmax * 100}%"></i></div><b>${types[k]}</b></div>`).join("");
  aiView.renderPanel();
  loadPool();
}

function renderShop() {
  const deck = state.deck, list = deck.to_buy || [];
  $("#shopCard").style.display = list.length ? "" : "none";
  if (!list.length) return;
  const byName = Object.fromEntries(deck.cards.map(c => [c.name, c]));
  $("#shopList").innerHTML = list.map(b => {
    const c = byName[b.name] || b;
    return `<div class="srow"><span>×${b.count} ${b.scryfall_uri ? `<a href="${b.scryfall_uri}" target="_blank" rel="noopener">${esc(cName(c))}</a>` : esc(cName(c))}
      ${b.owned ? `<small class="muted">(${t("ownedN")(b.owned)})</small>` : ""}</span><span>${b.price_eur != null ? (b.price_eur * b.count).toFixed(2) + " €" : "?"}</span></div>`;
  }).join("");
  const unknown = list.filter(b => b.price_eur == null).length;
  $("#shopTot").textContent = `${t("total")} ${deck.buy_cost} €` + (unknown ? ` (+${unknown} ${t("noPrice")})` : "");
}

// ------------------------------------------------------------ édition
const editOpts = () => ({ deckId: state.currentDeckId, useReserved: $("#useRes").checked });
const logText = l => {
  if (l.k === "colorsAdded") return t("colorsAdded")(l.colors.join(""));
  if (l.ok) return `${l.sign} ${l.n} ${cNameOf(l.name)}`;
  const reason = t("editErr")[l.k];
  return `✗ ${cNameOf(l.name)} : ${typeof reason === "function" ? reason(l) : reason}`;
};

/** Applique des changements validés. Retourne le journal (utilisé aussi par le chat IA). */
export async function editDeck(changes, { target = $("#editMsg"), swap = false, mentioned = [] } = {}) {
  const { deck, log } = await (swap ? deckService.swap : deckService.edit)(state.deck, changes, { ...editOpts(), mentioned });
  const errs = log.filter(l => !l.ok);
  if (target) msg(target, esc(log.map(logText).join(" · ")), errs.length ? "err" : "ok");
  if (errs.length < log.length) { state.deck = deck; renderDeck(); }
  return log.map(logText);
}

/** Aperçu des échanges proposés par l'IA, SANS les appliquer. Retourne { deck, log, lines, applicable }. */
export async function previewSwap(changes, mentioned = [], extraColors = []) {
  const { deck, log } = await deckService.swap(state.deck, changes, { ...editOpts(), mentioned, extraColors });
  return { deck, log, lines: log.map(logText), applicable: log.some(l => l.ok) };
}

/** Régénère le deck (60 cartes) en ajoutant des couleurs, avec les mêmes paramètres. */
export function regenerateWithColors(extra) {
  const deck = state.deck, colors = [...new Set([...deck.identity, ...extra])];
  $("#fmt").value = deck.format; $("#fmt").onchange();
  document.querySelectorAll("#colors input").forEach(i => { i.checked = colors.includes(i.value); });
  build({ ...(state.lastBody || {}), format: deck.format, colors, commander: "" }, true);
}

/** Valide un deck modifié (après accord du joueur). */
export function commitDeck(deck) {
  state.deck = deck;
  renderDeck();
}

async function loadPool() {
  pool = await deckService.addableCards(state.deck, editOpts());
  renderPool();
}
function renderPool() {
  const q = norm($("#deckAdd").value.trim()), el = $("#poolResults");
  if (!q) { el.innerHTML = ""; return; }
  const hits = pool.filter(p => [p.name, p.fr?.name, p.type_line, p.fr?.type_line, p.oracle_text, p.fr?.text].some(x => norm(x).includes(q))).slice(0, 30);
  if (!hits.length) { el.innerHTML = `<div class="muted small">${t("noPoolHit")}</div>`; return; }
  el.innerHTML = hits.map((p, i) => `<div class="res-card">${cImgS(p) ? `<img src="${cImgS(p)}" alt="">` : ""}
    <div class="ci"><b>${esc(cName(p))}${dfc(p)}</b><small>${esc(cType(p))}</small><small>${pips(p.mana_cost)} <span class="free">${t("freeN")(p.free)}</span></small></div>
    <button class="qb" data-pa="${i}" aria-label="+">+</button></div>`).join("");
  $$("#poolResults .res-card").forEach((c, i) => { c.querySelector(".ci").onclick = () => openSheet(hits[i]); });
  $$("#poolResults [data-pa]").forEach(b => b.onclick = () => editDeck({ add: [{ name: hits[b.dataset.pa].name, count: 1 }] }));
}

// ------------------------------------------------------------ enregistrement
function renderSaveButtons() {
  $("#saveDeck").textContent = state.currentDeckId ? t("updateDeck") : t("saveDeck");
  $("#saveNew").style.display = state.currentDeckId ? "" : "none";
}
async function saveDeck(asNew) {
  const name = $("#deckName").value.trim() || deckService.defaultDeckName(state.deck, cName);
  const e = await decksRepo.saveDeck(name, state.deck, asNew ? null : state.currentDeckId);
  state.currentDeckId = e.id; state.currentDeckName = e.name;
  renderSaveButtons();
  msg($("#saveMsg"), t("saved")(e.name), "ok");
  renderSuggestion(null);
  await refreshAll();
}

// ------------------------------------------------------------ init
export function init({ onRefreshAll }) {
  refreshAll = onRefreshAll;
  $("#fmtInfoBtn").onclick = () => $("#fmtHelp").classList.toggle("full");
  $("#fmt").onchange = () => {
    const cmd = $("#fmt").value === "commander";
    $("#cmd").style.display = cmd ? "" : "none"; $("#colors").style.display = cmd ? "none" : "flex";
    renderFmtHelp();
  };
  $("#go").onclick = () => build(currentParams(), true);
  $("#wish").onkeydown = e => { if (e.key === "Enter") $("#go").click(); };
  $$("#groupBy button").forEach(b => b.onclick = () => {
    state.groupBy = b.dataset.g; $$("#groupBy button").forEach(x => x.classList.toggle("on", x === b));
    renderDeck();
  });
  $("#deckAdd").oninput = renderPool;
  $("#saveDeck").onclick = () => saveDeck(false);
  $("#saveNew").onclick = () => saveDeck(true);
  $("#copy").onclick = async () => {
    const d = state.deck;
    await copyText([...(d.commander ? [`1 ${d.commander.name}`, ""] : []), ...d.cards.map(x => `${x.count} ${x.name}`)].join("\n"));
    flashBtn($("#copy"), "copy");
  };
  $("#copyShop").onclick = async () => {
    await copyText((state.deck.to_buy || []).map(b => `${b.count} ${b.name}`).join("\n"));
    flashBtn($("#copyShop"), "copyShop");
  };
  onLangChange(() => {
    $("#wish").placeholder = t("wishPh"); $("#deckAdd").placeholder = t("addToDeckPh"); $("#deckName").placeholder = t("deckNamePh");
    renderFmtHelp(); renderSaveButtons(); renderCommanders();
    if (state.lastSuggestion) renderSuggestion(state.lastSuggestion);
    renderDeck();
  });
}

function flashBtn(btn, key) {
  btn.textContent = t("copied");
  setTimeout(() => { btn.textContent = t(key); }, 1500);
}

// Onglet « Partie » : compteur de points de vie (2 à 6 joueurs), poison, blessures de commandant, dés.
// Le téléphone est posé au milieu de la table : les joueurs d'en face voient leur compteur à l'endroit.
import * as game from "../../core/game.js";
import * as decksRepo from "../../data/decksRepo.js";
import { $, $$, cImg, esc } from "../dom.js";
import { onLangChange, t } from "../state.js";

const COLORS = ["#7a3b2e", "#2e4f7a", "#2f6b45", "#62306b", "#7a662e", "#3d3d5c"];
const store = {
  get: k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sans stockage */ } },
};
let setup = store.get("gameSetup") || { n: 2, life: 20, commander: false, players: [] };
let g = store.get("gameState"), decks = [], wake = null;
const recent = {}; // changements récents par joueur (affichage « +3 »)

// ------------------------------------------------------------ réglages
export async function render() {
  decks = await decksRepo.listDecks().catch(() => []);
  const names = Array.from({ length: setup.n }, (_, i) => setup.players[i] || { name: "", deckId: "" });
  $("#gameSetup").innerHTML = `
    <div class="glabel">${t("gamePlayers")}</div>
    <div class="seg gseg" id="gN">${[2, 3, 4, 5, 6].map(n => `<button data-n="${n}" class="${n === setup.n ? "on" : ""}">${n}</button>`).join("")}</div>
    <div class="glabel">${t("gameLife")}</div>
    <div class="seg gseg" id="gLife">${[20, 30, 40].map(n => `<button data-l="${n}" class="${n === setup.life ? "on" : ""}">${n}</button>`).join("")}</div>
    <label class="chk"><input type="checkbox" id="gCmd" ${setup.commander ? "checked" : ""}><span>${t("gameCommander")}</span></label>
    <div class="gplayers">${names.map((p, i) => `<div class="gprow"><span class="gdot" style="background:${COLORS[i]}"></span>
      <input type="text" data-i="${i}" class="gname" value="${esc(p.name)}" placeholder="${esc(t("gamePlayerN")(i + 1))}">
      ${decks.length ? `<select class="small gdeck" data-i="${i}"><option value="">${t("gameNoDeck")}</option>${decks.map(d => `<option value="${esc(d.id)}" ${d.id === p.deckId ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select>` : ""}</div>`).join("")}</div>`;
  $$("#gN button").forEach(b => b.onclick = () => { setup.n = +b.dataset.n; saveSetup(); render(); });
  $$("#gLife button").forEach(b => b.onclick = () => { setup.life = +b.dataset.l; saveSetup(); render(); });
  $("#gCmd").onchange = () => {
    setup.commander = $("#gCmd").checked;
    if (setup.commander && setup.life === 20) setup.life = 40; // Commander : 40 points de vie
    saveSetup(); render();
  };
  $$("#gameSetup .gname").forEach(inp => inp.oninput = () => { (setup.players[inp.dataset.i] ||= {}).name = inp.value; saveSetup(); });
  $$("#gameSetup .gdeck").forEach(sel => sel.onchange = () => { (setup.players[sel.dataset.i] ||= {}).deckId = sel.value; saveSetup(); });
  $("#gameResume").hidden = !g;
}

const saveSetup = () => store.set("gameSetup", setup);
const saveGame = () => store.set("gameState", g);

function start() {
  const players = Array.from({ length: setup.n }, (_, i) => {
    const p = setup.players[i] || {}, d = decks.find(x => x.id === p.deckId);
    const c = d?.deck.commander || d?.deck.cards?.find(x => x.image);
    return { name: p.name?.trim() || t("gamePlayerN")(i + 1), deckId: d?.id || null, image: c ? cImg(c) : null };
  });
  g = game.newGame(players, { life: setup.life, commander: setup.commander });
  saveGame();
  openTable();
}

// ------------------------------------------------------------ table de jeu
async function openTable() {
  $("#gameTable").hidden = false;
  document.body.classList.add("noscroll");
  document.documentElement.requestFullscreen?.().catch(() => {});
  keepAwake();
  drawTable();
}

function closeTable() {
  $("#gameTable").hidden = true;
  document.body.classList.remove("noscroll");
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  wake?.release?.().catch(() => {}); wake = null;
  render();
}

/** L'écran reste allumé pendant la partie (si le navigateur le permet). */
async function keepAwake() {
  try { wake = await navigator.wakeLock?.request("screen"); } catch { wake = null; }
}

/** Joueurs du haut (retournés, face aux joueurs d'en face) et du bas. */
function rows() {
  const n = g.players.length, top = Math.floor(n / 2);
  return [g.players.map((_, i) => i).slice(0, top), g.players.map((_, i) => i).slice(top)];
}

function drawTable() {
  const [top, bottom] = rows();
  $("#gameTable").innerHTML = `
    <div class="grow2 top">${top.map(panel).join("")}</div>
    <div class="grow2">${bottom.map(panel).join("")}</div>
    <button class="gmenubtn" id="gMenuBtn" aria-label="${esc(t("gameMenu"))}">☰</button>
    <div class="gmenu" id="gMenu" hidden></div>
    <div class="gsheet" id="gSheet" hidden></div>`;
  $$("#gameTable .gp").forEach(bindPanel);
  $("#gMenuBtn").onclick = () => toggleMenu();
}

/** Illustration seule (sans le cadre ni le texte) : Scryfall la sert au même chemin, en « art_crop ». */
const artCrop = url => url.replace("/normal/", "/art_crop/").replace("/large/", "/art_crop/");

function panel(i) {
  const p = g.players[i];
  const bg = p.image ? `background-image:linear-gradient(rgba(0,0,0,.55),rgba(0,0,0,.72)),url('${esc(artCrop(p.image))}')` : "";
  return `<div class="gp" data-i="${i}" style="--c:${COLORS[i]};${bg}"><div class="gpin">${panelInner(i)}</div></div>`;
}

function panelInner(i) {
  const p = g.players[i], out = game.lostBy(g, i);
  const r = recent[i];
  const cmdMax = Math.max(0, ...p.cmd);
  return `<div class="gzone minus" data-d="-1"><span>−</span></div><div class="gzone plus" data-d="1"><span>+</span></div>
    <div class="gname2">${g.first === i ? "🎲 " : ""}${esc(p.name)}</div>
    <div class="glife ${out ? "out" : ""}">${p.life}</div>
    <div class="gdelta">${r && r.d ? (r.d > 0 ? "+" : "") + r.d : ""}</div>
    <div class="gbadges">${p.poison ? `<span title="${esc(t("gamePoison"))}">☣ ${p.poison}</span>` : ""}${g.commander && cmdMax ? `<span title="${esc(t("gameCmdDmg"))}">⚔ ${cmdMax}</span>` : ""}${out ? `<span class="gout">☠ ${t("gameLost")[out]}</span>` : ""}</div>
    <button class="gmore" data-more="${i}" aria-label="${esc(t("gameDetails"))}">⋯</button>`;
}

function updatePanel(i) {
  const el = $(`#gameTable .gp[data-i="${i}"]`);
  if (!el) return;
  el.querySelector(".gpin").innerHTML = panelInner(i);
  bindPanel(el);
}

/** Appui = ±1 ; appui long = ±10, répété tant qu'on garde le doigt. */
function bindPanel(el) {
  const i = +el.dataset.i;
  el.querySelectorAll(".gzone").forEach(z => {
    const d = +z.dataset.d;
    let timer = null, rep = null, held = false;
    const stop = () => { clearTimeout(timer); clearInterval(rep); timer = rep = null; };
    z.onpointerdown = e => {
      e.preventDefault();
      try { z.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ }
      held = false;
      timer = setTimeout(() => { held = true; life(i, 10 * d); rep = setInterval(() => life(i, 10 * d), 700); }, 450);
    };
    z.onpointerup = () => { const wasHeld = held; stop(); if (!wasHeld) life(i, d); };
    z.onpointercancel = stop;
    z.oncontextmenu = e => e.preventDefault();
  });
  el.querySelector(".gmore").onclick = () => openSheet(i);
}

function life(i, d) {
  g = game.changeLife(g, i, d);
  bump(i, d);
}

/** Mémorise le changement récent (« −3 ») et l'efface après 1,5 s sans action. */
function bump(i, d) {
  const r = recent[i] || (recent[i] = { d: 0, timer: null });
  r.d += d;
  clearTimeout(r.timer);
  r.timer = setTimeout(() => { r.d = 0; updatePanel(i); }, 1500);
  saveGame();
  updatePanel(i);
  navigator.vibrate?.(8);
}

// ------------------------------------------------------------ détails d'un joueur : poison, blessures de commandant
function openSheet(i) {
  const p = g.players[i], sheet = $("#gSheet");
  const row = (label, value, attr) => `<div class="gsrow"><span>${label}</span><div class="qty"><button class="qb" ${attr} data-d="-1">−</button><b>${value}</b><button class="qb" ${attr} data-d="1">+</button></div></div>`;
  sheet.hidden = false;
  sheet.innerHTML = `<div class="gsbody"><h3>${esc(p.name)}</h3>
    ${row(`☣ ${t("gamePoison")}`, p.poison, 'data-k="poison"')}
    ${g.commander ? `<div class="glabel">${t("gameCmdFrom")}</div>` + g.players.map((o, j) => j === i ? "" : row(`⚔ ${esc(o.name)}`, p.cmd[j], `data-k="cmd" data-j="${j}"`)).join("") : ""}
    <p class="muted small">${g.commander ? t("gameCmdHelp") : ""}</p>
    <button class="btn full" id="gSheetClose">${t("gameDone")}</button></div>`;
  sheet.querySelectorAll(".qb").forEach(b => b.onclick = () => {
    const d = +b.dataset.d;
    if (b.dataset.k === "poison") g = game.changePoison(g, i, d);
    else { g = game.changeCommanderDamage(g, i, +b.dataset.j, d); bump(i, -d); }
    saveGame(); updatePanel(i); openSheet(i);
  });
  $("#gSheetClose").onclick = () => { sheet.hidden = true; };
  sheet.onclick = e => { if (e.target === sheet) sheet.hidden = true; };
}

// ------------------------------------------------------------ menu : premier joueur, dé, recommencer, quitter
function toggleMenu(content = null) {
  const m = $("#gMenu");
  if (!m.hidden && !content) { m.hidden = true; return; }
  m.hidden = false;
  m.innerHTML = content || `
    <button class="btn" id="gFirst">${t("gameFirst")}</button>
    <button class="btn ghost" id="gD20">🎲 ${t("gameDie")} (d20)</button>
    <button class="btn ghost" id="gD6">🎲 d6</button>
    <button class="btn ghost" id="gCoin">🪙 ${t("gameCoin")}</button>
    <button class="btn ghost" id="gReset">↺ ${t("gameReset")}</button>
    <button class="btn danger" id="gQuit">✕ ${t("gameQuit")}</button>`;
  if (content) return;
  $("#gFirst").onclick = () => {
    g = game.pickFirst(g); saveGame(); drawTable();
    toggleMenu(`<div class="gbig">🎲 ${esc(g.players[g.first].name)}</div><div class="muted">${t("gameStarts")}</div>`);
    $("#gMenu").onclick = () => { $("#gMenu").hidden = true; $("#gMenu").onclick = null; };
  };
  const roll = label => () => {
    toggleMenu(`<div class="gbig">${label()}</div>`);
    $("#gMenu").onclick = () => { $("#gMenu").hidden = true; $("#gMenu").onclick = null; };
  };
  $("#gD20").onclick = roll(() => game.rollDie(20));
  $("#gD6").onclick = roll(() => game.rollDie(6));
  $("#gCoin").onclick = roll(() => (game.rollDie(2) === 1 ? t("gameHeads") : t("gameTails")));
  $("#gReset").onclick = () => { g = game.resetGame(g); saveGame(); drawTable(); };
  $("#gQuit").onclick = closeTable;
}

export function init() {
  $("#gameStart").onclick = start;
  $("#gameResume").onclick = () => { if (g) openTable(); };
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !$("#gameTable").hidden) keepAwake(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#gameTable").hidden && !document.fullscreenElement) closeTable(); });
  onLangChange(() => { if ($("#game").classList.contains("on")) render(); });
}

// IA locale : réglages (onglet Plus) et assistant du deck (onglet Construire).
import { marked } from "marked";
import * as assistant from "../../ai/assistant.js";
import { checkWebGPU, deviceMemoryGB, requestPersistence, storageEstimate } from "../../ai/capabilities.js";
import { ensureEngine, generate, isLoaded, unload } from "../../ai/engine.js";
import { DEFAULT_MODEL, MODELS } from "../../ai/models.js";
import * as modelStore from "../../ai/modelStore.js";
import { stripThinking } from "../../ai/prompts.js";
import { legalPool } from "../../core/editing.js";
import * as deckService from "../../services/deckService.js";
import { cardQuery } from "../../ai/cardQuery.js";
import { lookupCard, search, searchCards } from "../../data/scryfall/index.js";
import { $, $$, armButton, cName, esc, fmtBytes, msg, spin } from "../dom.js";
import { onLangChange, state, t } from "../state.js";
import { commitDeck, previewSwap, regenerateWithColors } from "./buildView.js";

const model = MODELS[DEFAULT_MODEL];
let device = null;        // résultat de checkWebGPU()
let status = { status: "absent" };
let downloadCtl = null;   // AbortController du téléchargement
let genCtl = null;        // AbortController de la génération
const mentions = new Map(); // cartes citées dans la conversation (nom anglais → carte complète)
let freshAttach = [];       // cartes jointes depuis le dernier message (annoncées au modèle)
const md = text => marked.parse(text || "", { breaks: true });

// ================================================================ réglages (Plus)
export async function refreshSettings() {
  const box = $("#aiBox");
  if (!device) { box.innerHTML = `<p class="muted small">${spin(t("aiChecking"))}</p>`; device = await checkWebGPU(); }
  status = await modelStore.getStatus(model);
  await renderSettings();
  renderPanel();
}

async function renderSettings() {
  const box = $("#aiBox");
  if (!device.webgpu) { box.innerHTML = `<p class="warn">${t("aiNoWebgpu")}</p>`; return; }
  const est = await storageEstimate();
  const ram = deviceMemoryGB();
  const info = [
    `<p class="muted small">${t("aiGpu")(device.gpu)}</p>`,
    est ? `<p class="muted small">${t("aiStorage")(fmtBytes(est.free), fmtBytes(est.quota))}</p>` : "",
    est && status.status !== "ready" && est.free < model.approxBytes * 1.1 ? `<p class="warn">${t("aiLowStorage")}</p>` : "",
    ram && ram < 6 ? `<p class="warn">${t("aiLowRam")(ram)}</p>` : "",
  ].join("");

  let actions;
  if (downloadCtl) {
    actions = `<div class="progress"><i id="aiBar"></i></div><div class="msg" id="aiDl"></div>
      <button class="btn ghost full" id="aiCancel">${t("aiCancel")}</button>`;
  } else if (status.status === "ready") {
    actions = `<p class="msg ok">${t("aiReady")} (${fmtBytes(status.total)})</p>
      <button class="btn full" id="aiTest">${t("aiTest")}</button><div class="ai-out" id="aiTestOut"></div>
      <button class="btn danger full" id="aiDelete">${t("aiDelete")}</button>`;
  } else {
    const label = status.status === "partial" ? t("aiResume")(fmtBytes(status.bytes), fmtBytes(status.total)) : t("aiDownload")(fmtBytes(model.approxBytes));
    actions = `<button class="btn full" id="aiDownload">${label}</button><p class="muted small">${t("aiWifi")}</p><div class="msg" id="aiDl"></div>`;
  }
  box.innerHTML = info + actions;

  if ($("#aiDownload")) $("#aiDownload").onclick = startDownload;
  if ($("#aiCancel")) $("#aiCancel").onclick = () => downloadCtl?.abort();
  if ($("#aiTest")) $("#aiTest").onclick = testModel;
  if ($("#aiDelete")) armButton($("#aiDelete"), async () => { await unload(); await modelStore.remove(model); await refreshSettings(); }, () => t("confirm"));
}

async function startDownload() {
  downloadCtl = new AbortController();
  await requestPersistence(); // évite que le navigateur efface le modèle s'il manque de place
  renderSettings();
  try {
    await modelStore.download(model, {
      signal: downloadCtl.signal,
      onProgress: (b, total) => {
        if ($("#aiBar")) $("#aiBar").style.width = `${Math.min(100, b / total * 100).toFixed(1)}%`;
        if ($("#aiDl")) $("#aiDl").textContent = t("aiDownloading")(fmtBytes(b), fmtBytes(total));
      },
    });
    downloadCtl = null;
    await refreshSettings();
  } catch (e) {
    const aborted = e.name === "AbortError";
    downloadCtl = null;
    await refreshSettings();
    if (!aborted && $("#aiDl")) msg($("#aiDl"), t("aiError")(e.message), "err");
  }
}

async function loadEngine(outEl) {
  if (isLoaded(model.id)) return;
  await ensureEngine(model, { onStatus: s => { if (outEl) outEl.innerHTML = spin(t("aiLoading")[s] || ""); } });
}

async function testModel() {
  const out = $("#aiTestOut");
  try {
    await loadEngine(out);
    const t0 = performance.now();
    let n = 0;
    const text = await generate(model, [{ role: "user", content: t("aiTestPrompt") }], {
      maxOutputTokens: 120, onToken: s => { n++; out.innerHTML = md(stripThinking(s)); },
    });
    const secs = (performance.now() - t0) / 1000;
    out.innerHTML = md(stripThinking(text)) + `<p class="muted small">${secs.toFixed(1)} s · ~${(n / secs).toFixed(1)} tok/s</p>`;
  } catch (e) {
    out.innerHTML = `<p class="msg err">${esc(t("aiError")(e.message))}</p>`;
  }
}

// ================================================================ assistant (Construire)
const ready = () => device?.webgpu && status.status === "ready";

/** Appelé quand un nouveau deck est affiché : on repart d'une conversation vide. */
export function onNewDeck() {
  genCtl?.abort();
  state.chatHistory = [];
  mentions.clear();
  freshAttach = [];
  if ($("#aiPanel")) $("#aiPanel").innerHTML = ""; // redessiné par renderPanel()
}

export function renderPanel() {
  const panel = $("#aiPanel");
  if (!panel || !state.deck) return;
  if (!ready()) {
    panel.innerHTML = `<h2>🤖 ${t("aiPanel")}</h2><p class="muted small">${device && !device.webgpu ? t("aiNoWebgpu") : t("aiNotReady")}</p>`;
    return;
  }
  if ($("#aiAnalyze")) return; // déjà affiché : on garde la conversation en cours
  panel.innerHTML = `<h2>🤖 ${t("aiPanel")} <small class="muted">· ${model.label}</small></h2>
    <div class="row wrap"><button class="btn small" id="aiAnalyze">${t("aiAnalyze")}</button>
      ${state.deck.wish ? `<button class="btn small ghost" id="aiRefine">${t("aiRefine")}</button>` : ""}
      <button class="btn small ghost" id="aiStop" style="display:none">${t("aiStop")}</button>
      <button class="btn small ghost" id="aiReset">${t("aiReset")}</button></div>
    <div class="ai-out" id="aiOut"></div>
    <div class="chat" id="chat"></div>
    <div class="chips" id="chips"></div>
    <div class="attach" id="attachBox" hidden>
      <input type="search" id="attachIn" placeholder="${esc(t("attachPh"))}" autocomplete="off">
      <div class="results" id="attachRes"></div>
    </div>
    <div class="chatin"><button class="qb" id="attachBtn" title="${esc(t("attachTitle"))}" aria-label="${esc(t("attachTitle"))}">📎</button>
      <input type="text" id="chatIn" enterkeyhint="send" placeholder="${esc(t("chatPh"))}"><button class="btn" id="chatGo">${t("send")}</button></div>
    <div class="muted small">${t("aiHint")}</div>`;
  $("#aiAnalyze").onclick = analyze;
  if ($("#aiRefine")) $("#aiRefine").onclick = () => sendChat(t("refinePrompt")(state.deck.wish.text));
  $("#aiStop").onclick = () => genCtl?.abort();
  $("#aiReset").onclick = resetChat;
  $("#chatGo").onclick = () => sendChat();
  $("#chatIn").onkeydown = e => { if (e.key === "Enter") sendChat(); };
  $("#attachBtn").onclick = () => { $("#attachBox").hidden = !$("#attachBox").hidden; if (!$("#attachBox").hidden) $("#attachIn").focus(); };
  let timer = null;
  $("#attachIn").oninput = () => {
    clearTimeout(timer);
    const q = $("#attachIn").value.trim();
    if (q.length < 2) { $("#attachRes").innerHTML = ""; return; }
    timer = setTimeout(() => attachSearch(q), 400);
  };
  renderChips();
}

/** Nouvelle conversation : efface l'historique, les cartes jointes et l'analyse (le deck n'est pas modifié). */
function resetChat() {
  genCtl?.abort();
  state.chatHistory = [];
  mentions.clear();
  freshAttach = [];
  if ($("#chat")) $("#chat").innerHTML = "";
  if ($("#aiOut")) $("#aiOut").innerHTML = "";
  renderChips();
}

// ------------------------------------------------------------ cartes citées / jointes
const ownedCount = name => state.collection.find(c => c.name === name)?.free ?? 0;

function addMention(card) {
  mentions.set(card.name, { ...card, owned: ownedCount(card.name) });
  renderChips();
}

function renderChips() {
  const el = $("#chips");
  if (!el) return;
  el.innerHTML = [...mentions.values()].map(m => `<span class="chip">📎 ${esc(cName(m))}
    <small>${m.owned ? t("ownedN")(m.owned) : t("toBuy")}</small><button data-rm="${esc(m.name)}" aria-label="×">×</button></span>`).join("");
  $$("#chips [data-rm]").forEach(b => { b.onclick = () => { mentions.delete(b.dataset.rm); renderChips(); }; });
}

async function attachSearch(q) {
  const box = $("#attachRes");
  box.innerHTML = `<div class="muted small">${spin(t("searching"))}</div>`;
  let res = [];
  try { res = await search(q, state.lang, 6); } catch (e) { box.innerHTML = `<div class="msg err">${esc(e.message)}</div>`; return; }
  box.innerHTML = res.length ? res.map((r, i) => `<div class="res-card" data-i="${i}">${r.image_small ? `<img src="${r.image_small}" alt="">` : ""}
    <div class="ci"><b>${esc(state.lang === "fr" && r.printed_name ? r.printed_name : r.name)}</b><small>${esc(r.type_line)}</small></div>
    <button class="qb" aria-label="+">+</button></div>`).join("") : `<div class="muted small">${t("noResult")}</div>`;
  $$("#attachRes .res-card").forEach(el => {
    el.querySelector("button").onclick = async () => {
      const card = await lookupCard(res[el.dataset.i].name, state.lang).catch(() => null);
      if (card) { addMention(card); freshAttach.push(card); $("#attachIn").value = ""; box.innerHTML = ""; $("#attachBox").hidden = true; }
    };
  });
}

/**
 * Repère les cartes citées dans le message (collection, puis Scryfall), et si le joueur demande
 * des cartes (« ajoute des soldats blancs »), cherche sur Scryfall pour lui. Retourne une note à afficher.
 */
async function detectMentions(text, isPreset) {
  const found = assistant.mentionedInCollection(text, state.collection);
  found.forEach(addMention);
  const q = cardQuery(text, state.deck);
  if (q) {
    const inDeck = new Set(state.deck.cards.map(c => c.name));
    const cards = (await searchCards(q.query, 8).catch(() => [])).filter(c => !inDeck.has(c.name)).slice(0, 6);
    cards.forEach(addMention);
    if (!cards.length) return t("scryNone")(q.criteria.join(", "));
    const off = cards.filter(c => !(c.color_identity || []).every(x => state.deck.identity.includes(x)));
    return t("scryFound")(q.criteria.join(", "), cards.map(c => cName(c)).join(", ")) + (off.length ? " " + t("scryOff")(off.length, state.deck.identity.join("") || "C") : "");
  }
  if (found.length || isPreset) return "";
  const cand = assistant.candidateName(text);
  if (!cand) return "";
  const card = await lookupCard(cand, state.lang).catch(() => null);
  if (card && assistant.looksLike(cand, card)) addMention(card);
  return "";
}

function busy(on) {
  genCtl = on ? new AbortController() : null;
  for (const id of ["aiAnalyze", "chatGo", "aiRefine"]) if ($("#" + id)) $("#" + id).disabled = on;
  if ($("#aiStop")) $("#aiStop").style.display = on ? "" : "none";
}

const freeCards = () => deckService.editablePool(state.currentDeckId, $("#useRes").checked);

async function analyze() {
  const out = $("#aiOut");
  busy(true);
  try {
    await loadEngine(out);
    out.innerHTML = spin(t("aiThinking"));
    const text = await assistant.explain(model, state.deck, await freeCards(), state.lang, {
      signal: genCtl.signal, onToken: s => { out.innerHTML = md(s); },
    });
    out.innerHTML = md(text);
  } catch (e) {
    out.innerHTML = `<p class="msg err">${esc(t("aiError")(e.message))}</p>`;
  }
  busy(false);
}

function bubble(role, html) {
  const d = document.createElement("div");
  d.className = "bubble " + role; d.innerHTML = html;
  $("#chat").appendChild(d); d.scrollIntoView({ block: "nearest", behavior: "smooth" });
  return d;
}

async function sendChat(preset) {
  const input = $("#chatIn"), text = (preset || input.value).trim();
  if (!text || genCtl) return;
  input.value = "";
  // les cartes jointes sont annoncées explicitement au modèle (« cette carte » = la pièce jointe)
  const attached = freshAttach.splice(0);
  const attachNote = attached.length ? `[${t("attachedNote")} : ${attached.map(c => cName(c)).join(", ")}] ` : "";
  bubble("user", (attached.length ? `<div class="muted small">📎 ${esc(attached.map(c => cName(c)).join(", "))}</div>` : "") + esc(text));
  state.chatHistory.push({ role: "user", content: attachNote + text });
  const b = bubble("assistant", spin(t("aiThinking")));
  busy(true);
  try {
    b.innerHTML = spin(t("lookingUp"));
    const note = await detectMentions(text, !!preset);
    if (note) {
      b.insertAdjacentHTML("beforebegin", `<div class="muted small scrynote">🔎 ${esc(note)}</div>`);
      // le modèle sait que ces cartes viennent d'être cherchées pour lui
      state.chatHistory[state.chatHistory.length - 1].content += `\n[${note}]`;
    }
    await loadEngine(b);
    const free = await freeCards();
    const available = legalPool(free, state.deck); // seulement ce qui peut vraiment entrer dans ce deck
    const mentioned = [...mentions.values()];
    const { text: answer, changes, runaway } = await assistant.chat(model, state.deck, available, state.chatHistory, state.lang, {
      signal: genCtl.signal, everything: state.collection, mentioned, onToken: s => { b.innerHTML = md(s); },
    });
    b.innerHTML = md(answer || "…");
    if (runaway) b.insertAdjacentHTML("beforeend", `<div class="muted small">⚠ ${t("aiRunaway")}</div>`);
    const entry = { role: "assistant", content: answer || "" };
    state.chatHistory.push(entry);
    if (changes) await showProposal(b, changes, entry);
  } catch (e) {
    b.innerHTML = `<p class="msg err">${esc(t("aiError")(e.message))}</p>`;
  }
  busy(false);
}

/** Affiche les échanges proposés (vérifiés mais pas appliqués) avec Appliquer / Ignorer. */
async function showProposal(bubbleEl, changes, historyEntry) {
  const ments = () => [...mentions.values()];
  const preview = await previewSwap(changes, ments());
  const resultLabel = state.lang === "fr" ? "Résultat" : "Result";
  // cartes refusées seulement pour leur couleur (60 cartes) : on peut ajouter la couleur au deck
  const missing = [...new Set(preview.log.filter(l => l.k === "offColor").flatMap(l => l.missing || []))];
  const canWiden = missing.length > 0 && state.deck.format !== "commander" && state.deck.identity.length + missing.length <= 3;
  const wide = canWiden ? await previewSwap(changes, ments(), missing) : null;
  const useWide = wide && wide.log.filter(l => l.ok).length > preview.log.filter(l => l.ok).length;
  const cmdNote = missing.length && state.deck.format === "commander" ? `<div class="muted small">${t("cmdColors")}</div>` : "";

  if (!preview.applicable && !useWide) {
    bubbleEl.insertAdjacentHTML("beforeend", `<div class="proposal"><b>${t("propNone")}</b><div class="changes err">${esc(preview.lines.join("\n"))}</div>${cmdNote}
      ${canWiden ? `<button class="btn small" data-recolor="${missing.join("")}">${t("recolor")(missing.join(""))}</button>` : ""}</div>`);
    const btn = bubbleEl.querySelector("[data-recolor]");
    if (btn) btn.onclick = () => regenerateWithColors(btn.dataset.recolor.split(""));
    historyEntry.content += `\n\n${resultLabel} : ${t("propNone")} (${preview.lines.join(" ; ")})`;
    return;
  }
  const lineHtml = lines => lines.map(l => `<div class="${l.startsWith("✗") ? "err" : ""}">${esc(l)}</div>`).join("");
  const box = document.createElement("div");
  box.className = "proposal";
  const shown = useWide ? wide : preview;
  const col = missing.join("");
  box.innerHTML = `<b>${useWide ? t("propWiden")(col) : t("propTitle")}</b>
    <div class="changes">${lineHtml(shown.lines)}</div>${cmdNote}
    <div class="row">
      ${useWide ? `<button class="btn small" data-act="widen">${t("propWidenApply")(col)}</button>` : ""}
      ${preview.applicable ? `<button class="btn small ${useWide ? "ghost" : ""}" data-act="apply">${useWide ? t("propApplyNoColor") : t("propApply")}</button>` : ""}
      ${useWide ? `<button class="btn small ghost" data-act="regen">${t("recolor")(col)}</button>` : ""}
      <button class="btn small ghost" data-act="skip">${t("propSkip")}</button></div>`;
  bubbleEl.appendChild(box);
  historyEntry.content += `\n\n${resultLabel} : ${t("propPending")}`;
  const commit = async extra => {
    // recalcul au moment du clic (le deck a pu changer entre-temps)
    const fresh = await previewSwap(changes, ments(), extra);
    if (fresh.applicable) commitDeck(fresh.deck);
    box.innerHTML = `<div class="changes">${esc(t("propApplied"))}\n${esc(fresh.lines.join("\n"))}</div>`;
    historyEntry.content = historyEntry.content.replace(t("propPending"), `${t("propApplied")} ${fresh.lines.join(" ; ")}`);
  };
  box.querySelector('[data-act="apply"]')?.addEventListener("click", () => commit([]));
  box.querySelector('[data-act="widen"]')?.addEventListener("click", () => commit(missing));
  box.querySelector('[data-act="regen"]')?.addEventListener("click", () => regenerateWithColors(missing));
  box.querySelector('[data-act="skip"]').onclick = () => {
    box.innerHTML = `<div class="muted small">${t("propSkipped")}</div>`;
    historyEntry.content = historyEntry.content.replace(t("propPending"), t("propSkipped"));
  };
}

export function init() {
  onLangChange(() => {
    if (device) renderSettings();
    if ($("#aiPanel")) { $("#aiPanel").innerHTML = ""; renderPanel(); }
  });
}

// IA locale : réglages (onglet Plus) et assistant du deck (onglet Construire).
import { marked } from "marked";
import * as assistant from "../../ai/assistant.js";
import { checkWebGPU, deviceMemoryGB, requestPersistence, storageEstimate } from "../../ai/capabilities.js";
import { ensureEngine, generate, isLoaded, unload } from "../../ai/engine.js";
import { DEFAULT_MODEL, MODELS } from "../../ai/models.js";
import * as modelStore from "../../ai/modelStore.js";
import { stripThinking } from "../../ai/prompts.js";
import * as deckService from "../../services/deckService.js";
import { $, armButton, esc, fmtBytes, msg, spin } from "../dom.js";
import { onLangChange, state, t } from "../state.js";
import { editDeck } from "./buildView.js";

const model = MODELS[DEFAULT_MODEL];
let device = null;        // résultat de checkWebGPU()
let status = { status: "absent" };
let downloadCtl = null;   // AbortController du téléchargement
let genCtl = null;        // AbortController de la génération
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
      <button class="btn small ghost" id="aiStop" style="display:none">${t("aiStop")}</button></div>
    <div class="ai-out" id="aiOut"></div>
    <div class="chat" id="chat"></div>
    <div class="chatin"><input type="text" id="chatIn" enterkeyhint="send" placeholder="${esc(t("chatPh"))}"><button class="btn" id="chatGo">${t("send")}</button></div>
    <div class="muted small">${t("aiHint")}</div>`;
  $("#aiAnalyze").onclick = analyze;
  if ($("#aiRefine")) $("#aiRefine").onclick = () => sendChat(t("refinePrompt")(state.deck.wish.text));
  $("#aiStop").onclick = () => genCtl?.abort();
  $("#chatGo").onclick = () => sendChat();
  $("#chatIn").onkeydown = e => { if (e.key === "Enter") sendChat(); };
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
  bubble("user", esc(text));
  state.chatHistory.push({ role: "user", content: text });
  const b = bubble("assistant", spin(t("aiThinking")));
  busy(true);
  try {
    await loadEngine(b);
    const available = await freeCards();
    const { text: answer, changes } = await assistant.chat(model, state.deck, available, state.chatHistory, state.lang, {
      signal: genCtl.signal, everything: state.collection, onToken: s => { b.innerHTML = md(s); },
    });
    state.chatHistory.push({ role: "assistant", content: answer });
    b.innerHTML = md(answer || "…");
    if (changes) {
      const log = await editDeck(changes, { target: null });
      if (log.length) b.insertAdjacentHTML("beforeend", `<div class="changes">${t("applied")}\n${esc(log.join("\n"))}</div>`);
    }
  } catch (e) {
    b.innerHTML = `<p class="msg err">${esc(t("aiError")(e.message))}</p>`;
  }
  busy(false);
}

export function init() {
  onLangChange(() => {
    if (device) renderSettings();
    if ($("#aiPanel")) { $("#aiPanel").innerHTML = ""; renderPanel(); }
  });
}

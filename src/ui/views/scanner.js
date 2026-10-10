// Scanner de cartes (à la ManaBox) : caméra → OCR local (Tesseract) → identification Scryfall → ajout à la collection.
// Le nom est lu dans le cartouche du haut ; sur les cartes récentes, le bas à gauche donne l'impression exacte.
import { prints } from "../../data/scryfall/index.js";
import { getSets } from "../../data/scryfall/sets.js";
import * as collectionService from "../../services/collectionService.js";
import { identify, identifyFromAi } from "../../services/scanService.js";
import { checkWebGPU } from "../../ai/capabilities.js";
import { readCardImage } from "../../ai/cardVision.js";
import { ensureEngine } from "../../ai/engine.js";
import { getStatus } from "../../ai/modelStore.js";
import { DEFAULT_MODEL, MODELS } from "../../ai/models.js";
import { $, cImgS, cName, esc, spin } from "../dom.js";
import { state, t } from "../state.js";

// zones de la carte (en fractions du cadre 63×88) : cartouche du nom, et bas à gauche
const TITLE = { x: 0.05, y: 0.035, w: 0.72, h: 0.075 };
const FOOTER = { x: 0.03, y: 0.905, w: 0.5, h: 0.08 };
// cartouche élargi : sur une image figée, la carte n'est pas toujours bien alignée dans le cadre
const TITLE_WIDE = { x: 0.02, y: 0.015, w: 0.8, h: 0.115 };
const PREF = "scanCamera";

let worker = null, workerLoading = null, PSM = null;
let stream = null, devices = [], deviceIdx = 0, running = false, paused = false, timer = null;
let knownSets = new Set(), pending = null, lastKey = null, emptyFrames = 0, candidate = null;
let session = [], changed = false, onClose = () => {};
const auto = { on: false };
const model = MODELS[DEFAULT_MODEL];
let aiReady = false, aiBusy = false, aiMode = false, still = 0, lastSig = null;
let frozen = false; // image figée (« photo » non enregistrée) : la lecture se fait sur cette image, sans flou de bouger

const pref = { get: () => { try { return localStorage.getItem(PREF); } catch { return null; } }, set: v => { try { localStorage.setItem(PREF, v); } catch { /* sans stockage */ } } };

function status(html) { $("#scanStatus").innerHTML = html; }

export async function openScanner({ onClosed } = {}) {
  onClose = onClosed || (() => {});
  changed = false; session = []; pending = null; lastKey = null; candidate = null;
  $("#scanner").hidden = false;
  document.body.classList.add("noscroll");
  $("#scanAuto").checked = auto.on;
  unfreeze(true);
  renderResult(); renderSession();
  if (!navigator.mediaDevices?.getUserMedia) { status(`⚠ ${t("scanNoCam")}`); return; }
  getSets().then(m => { knownSets = new Set(m.keys()); }).catch(() => {});
  await startCamera();
  checkAi();
  loadOcr();
}

/** Le bouton IA n'apparaît que si le modèle est téléchargé et WebGPU disponible. */
async function checkAi() {
  try { aiReady = (await getStatus(model)).status === "ready" && (await checkWebGPU()).webgpu; } catch { aiReady = false; }
  $("#scanAi").hidden = !aiReady;
  $("#scanAiModeBox").hidden = !aiReady;
}

async function close() {
  running = false; clearTimeout(timer);
  unfreeze(true);
  stream?.getTracks().forEach(tr => tr.stop()); stream = null;
  $("#scanVideo").srcObject = null;
  $("#scanner").hidden = true;
  document.body.classList.remove("noscroll");
  if (changed) onClose();
}

// ------------------------------------------------------------ caméra
async function startCamera() {
  stream?.getTracks().forEach(tr => tr.stop());
  const id = devices[deviceIdx]?.deviceId || pref.get();
  const video = { width: { ideal: 1920 }, height: { ideal: 1080 }, ...(id ? { deviceId: { exact: id } } : { facingMode: { ideal: "environment" } }) };
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
  } catch (e) {
    if (id) { pref.set(""); devices = []; return startCamera(); } // caméra mémorisée débranchée
    status(`⚠ ${e.name === "NotAllowedError" ? t("scanDenied") : t("scanNoCam")} (${esc(e.message)})`);
    return;
  }
  const v = $("#scanVideo");
  v.srcObject = stream;
  await v.play().catch(() => {});
  // la liste des caméras (avec leurs noms) n'est disponible qu'une fois l'accès accordé
  devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput");
  const cur = stream.getVideoTracks()[0]?.getSettings().deviceId;
  deviceIdx = Math.max(0, devices.findIndex(d => d.deviceId === cur));
  $("#scanSwitch").hidden = devices.length < 2;
  const caps = stream.getVideoTracks()[0]?.getCapabilities?.() || {};
  $("#scanTorch").hidden = !caps.torch;
  run(); // la boucle tourne même si la lecture de texte n'est pas encore prête (le mode IA n'en a pas besoin)
}

async function switchCamera() {
  if (devices.length < 2) return;
  deviceIdx = (deviceIdx + 1) % devices.length;
  unfreeze(true);
  pref.set(devices[deviceIdx].deviceId);
  running = false; clearTimeout(timer);
  await startCamera();
}

let torch = false;
async function toggleTorch() {
  torch = !torch;
  await stream?.getVideoTracks()[0]?.applyConstraints({ advanced: [{ torch }] }).catch(() => { torch = false; });
}

// ------------------------------------------------------------ OCR
function loadOcr() {
  if (worker) { status(t("scanAim")); return; }
  if (!workerLoading) {
    workerLoading = (async () => {
      const T = await import("tesseract.js");
      PSM = T.PSM;
      worker = await T.createWorker(["eng", "fra"], 1, {
        // progression du chargement seulement (le logger signale aussi chaque lecture une fois prêt)
        logger: m => { if (!worker && m.status && m.progress < 1 && !aiMode && !pending) status(spin(`${t("scanLoading")} ${Math.round((m.progress || 0) * 100)} %`)); },
      });
    })().catch(e => { workerLoading = null; throw e; });
  }
  status(spin(t("scanLoading")));
  workerLoading.then(() => { if (stream && !aiMode && !pending) status(t("scanAim")); })
    .catch(e => status(`⚠ ${t("scanOcrErr")} (${esc(e.message)})`));
}

/** Image à lire : la vidéo en direct, ou l'image figée (même cadre à l'écran, mêmes dimensions). */
function source() {
  const v = $("#scanVideo");
  if (frozen) { const c = $("#scanFrozen"); return { el: c, w: c.width, h: c.height, r: v.getBoundingClientRect() }; }
  return v.videoWidth ? { el: v, w: v.videoWidth, h: v.videoHeight, r: v.getBoundingClientRect() } : null;
}

/** Seuil d'Otsu : sépare au mieux le texte du fond (niveaux de gris 0..255). */
function otsu(hist, n) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, th = 127;
  for (let i = 0; i < 256; i++) {
    wB += hist[i]; if (!wB) continue;
    const wF = n - wB; if (!wF) break;
    sumB += i * hist[i];
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
    if (between > best) { best = between; th = i; }
  }
  return th;
}

/**
 * Partie de l'image sous une zone du cadre de visée → canvas en niveaux de gris, contrasté, agrandi.
 * binarize : noir et blanc franc (utile sur les cartes brillantes ou peu éclairées).
 */
function grab(zone, { binarize = false } = {}) {
  const src = source(), g = $("#scanGuide").getBoundingClientRect();
  if (!src) return null;
  const { el: v, r } = src;
  // l'image remplit son cadre (object-fit: cover) : on convertit les coordonnées écran → pixels de l'image
  const s = Math.max(r.width / src.w, r.height / src.h);
  const ox = (r.width - src.w * s) / 2, oy = (r.height - src.h * s) / 2;
  const sx = (g.left - r.left + zone.x * g.width - ox) / s, sy = (g.top - r.top + zone.y * g.height - oy) / s;
  const sw = zone.w * g.width / s, sh = zone.h * g.height / s;
  const scale = Math.min(4, Math.max(1, 90 / sh)); // ~90 px de haut pour l'OCR
  const c = document.createElement("canvas");
  c.width = Math.round(sw * scale); c.height = Math.round(sh * scale);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height), d = img.data;
  let min = 255, max = 0, sum = 0, sum2 = 0;
  const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) {
    const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = y; if (y < min) min = y; if (y > max) max = y; sum += y; sum2 += y * y;
  }
  const mean = sum / n, sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  const invert = mean < 110; // texte clair sur fond sombre (bas de carte noir, cadres sombres)
  const hist = new Array(256).fill(0);
  for (let i = 0; i < d.length; i += 4) {
    let y = (d[i] - min) / Math.max(1, max - min) * 255;
    if (invert) y = 255 - y;
    d[i] = d[i + 1] = d[i + 2] = y;
    hist[y | 0]++;
  }
  if (binarize) {
    const th = otsu(hist, n);
    for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = d[i] > th ? 255 : 0;
  }
  ctx.putImageData(img, 0, 0);
  return { canvas: c, sd };
}

/** Photo couleur de la carte (zone du cadre) pour l'IA. */
function grabCard() {
  const src = source(), g = $("#scanGuide").getBoundingClientRect();
  if (!src) return null;
  const { el: v, r } = src;
  const s = Math.max(r.width / src.w, r.height / src.h);
  const ox = (r.width - src.w * s) / 2, oy = (r.height - src.h * s) / 2;
  // un peu de marge autour du cadre : la carte n'est jamais parfaitement alignée
  const m = 0.06;
  const sx = (g.left - r.left - m * g.width - ox) / s, sy = (g.top - r.top - m * g.height - oy) / s;
  const sw = g.width * (1 + 2 * m) / s, sh = g.height * (1 + 2 * m) / s;
  const scale = Math.min(1, 768 / sh);
  const c = document.createElement("canvas");
  c.width = Math.round(sw * scale); c.height = Math.round(sh * scale);
  c.getContext("2d").drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}

/** Signature grossière de l'image (pour savoir si la carte est immobile dans le cadre). */
function signature(canvas) {
  const c = document.createElement("canvas"); c.width = 16; c.height = 22;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, 16, 22);
  const d = ctx.getImageData(0, 0, 16, 22).data, out = [];
  for (let i = 0; i < d.length; i += 4) out.push((d[i] + d[i + 1] + d[i + 2]) / 3);
  return out;
}
const sigDiff = (a, b) => a.reduce((acc, x, i) => acc + Math.abs(x - b[i]), 0) / a.length;
const sigSpread = a => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); };

/** Demande à l'IA de reconnaître la carte du cadre. */
async function askAi() {
  if (!aiReady || aiBusy || pending) return;
  const canvas = grabCard();
  if (!canvas) return;
  aiBusy = true; paused = true;
  $("#scanAi").disabled = true;
  status(spin(t("scanAiLoading")));
  try {
    await ensureEngine(model, { onStatus: st => { if (st !== "ready") status(spin(t("scanAiLoading"))); } });
    status(spin(t("scanAiLooking")));
    const blob = await new Promise(r => canvas.toBlob(r, "image/jpeg", 0.9));
    const read = await readCardImage(model, blob, state.lang);
    $("#scanRead").textContent = read ? `🤖 ${[read.name, read.set && read.number ? `${read.set.toUpperCase()} ${read.number}` : ""].filter(Boolean).join(" · ")}` : "";
    const hit = await identifyFromAi(read, { lang: state.lang, localCards: state.collection });
    if (hit) { paused = false; found(hit); }
    else { status(`⚠ ${t("scanAiMiss")}${frozen ? " " + t("scanFrozenRetry") : ""}`); paused = false; }
  } catch (e) {
    console.warn("scan IA", e);
    status(`⚠ ${t("scanAiErr")} (${esc(e.message || e)})`);
    paused = false;
  }
  aiBusy = false;
  $("#scanAi").disabled = false;
}

async function read(canvas, psm) {
  await worker.setParameters({ tessedit_pageseg_mode: psm });
  const { data } = await worker.recognize(canvas);
  return { text: data.text || "", conf: data.confidence || 0 };
}

function run() {
  if (running) return;
  running = true;
  const tick = async () => {
    if (!running) return;
    if (!paused && !frozen && stream) {
      try { aiMode ? aiFrame() : await scanFrame(); } catch (e) { console.warn("scan", e); }
    }
    timer = setTimeout(tick, 250);
  };
  tick();
}

// ------------------------------------------------------------ image figée
/** Fige l'image de la caméra (rien n'est enregistré) et la lit tranquillement, sans flou de bouger. */
async function freeze() {
  const v = $("#scanVideo");
  if (frozen || !stream || !v.videoWidth || aiBusy) return;
  const c = $("#scanFrozen");
  c.width = v.videoWidth; c.height = v.videoHeight;
  c.getContext("2d").drawImage(v, 0, 0);
  frozen = true; candidate = null; lastKey = null;
  c.hidden = false; $("#scanFrozenBadge").hidden = false;
  renderFreezeBtn();
  navigator.vibrate?.(30);
  if (pending) return; // une carte attend déjà d'être ajoutée
  if (aiMode && aiReady) return askAi();
  await scanFrozen();
}

/** Relance la caméra en direct. `silent` : sans message (ouverture, fermeture, changement de caméra). */
function unfreeze(silent = false) {
  const was = frozen;
  frozen = false;
  $("#scanFrozen").hidden = true; $("#scanFrozenBadge").hidden = true;
  renderFreezeBtn();
  if (was && !silent && !pending) status(aiMode ? t("scanAimAi") : t("scanAim"));
}

const toggleFreeze = () => (frozen ? unfreeze() : freeze());

function renderFreezeBtn() {
  $("#scanFreeze").textContent = frozen ? t("scanResume") : t("scanFreeze");
  $("#scanFreeze").classList.toggle("ghost", frozen);
}

/** Lecture approfondie de l'image figée : plusieurs réglages, et le nom lu une seule fois suffit. */
async function scanFrozen() {
  if (!worker) {
    status(spin(t("scanLoading")));
    try { await workerLoading; } catch { return; }
    if (!frozen || !worker) return;
  }
  status(spin(t("scanFrozenReading")));
  const tries = [[TITLE, {}], [TITLE, { binarize: true }], [TITLE_WIDE, { binarize: true }]];
  let lastRead = "";
  for (const [zone, opts] of tries) {
    const title = grab(zone, opts), footer = grab(FOOTER, opts);
    if (!title) break;
    const tr = await read(title.canvas, PSM.SINGLE_LINE), fr = await read(footer.canvas, PSM.SINGLE_BLOCK);
    if (!frozen) return; // l'utilisateur a relancé la caméra entre-temps
    lastRead = tr.text.trim().slice(0, 60) || lastRead;
    $("#scanRead").textContent = lastRead;
    const hit = await identify({ title: tr.conf >= 40 ? tr.text : "", footer: fr.text }, { lang: state.lang, knownSets, localCards: state.collection });
    if (!frozen) return;
    if (hit) return found(hit);
  }
  status(`⚠ ${t("scanFrozenMiss")}${aiReady ? " " + t("scanFrozenTryAi") : ""}`);
}

async function scanFrame() {
  if (!worker) return;
  const title = grab(TITLE), footer = grab(FOOTER);
  if (!title || title.sd < 14) return noCard(); // rien de net dans le cadre
  const tr = await read(title.canvas, PSM.SINGLE_LINE), fr = await read(footer.canvas, PSM.SINGLE_BLOCK);
  if (!running || paused || frozen) return;
  $("#scanRead").textContent = tr.text.trim().slice(0, 60);
  // lecture trop incertaine du nom : on ne garde que le bas de carte (évite des recherches sur du bruit)
  const hit = await identify({ title: tr.conf >= 55 ? tr.text : "", footer: fr.text }, { lang: state.lang, knownSets, localCards: state.collection });
  if (!hit) return noCard();
  emptyFrames = 0;
  if (hit.key === lastKey) return; // même carte que celle qu'on vient de traiter : on attend qu'elle sorte du cadre
  // impression lue en bas de carte = fiable tout de suite ; un nom seul doit être lu deux fois de suite
  if (hit.how !== "footer" && candidate !== hit.key) { candidate = hit.key; return; }
  candidate = null;
  found(hit);
}

/** Mode IA : dès que la carte reste immobile dans le cadre (~1 s), on la montre à l'IA. */
function aiFrame() {
  if (aiBusy) return;
  const canvas = grabCard();
  if (!canvas) return;
  const sig = signature(canvas);
  if (sigSpread(sig) < 12) { lastSig = sig; still = 0; lastKey = null; return; } // cadre vide
  const prev = lastSig;
  lastSig = sig;
  if (!prev) return; // première image : rien à comparer
  if (sigDiff(sig, prev) > 6) { still = 0; lastKey = null; status(t("scanAimAi")); return; } // carte changée ou en mouvement
  if (++still === 4 && !lastKey) askAi(); // immobile depuis ~1 s, et pas déjà traitée
}

function noCard() {
  if (++emptyFrames >= 3) { lastKey = null; candidate = null; } // carte retirée : on pourra rescanner la même
}

function beep() {
  navigator.vibrate?.(60);
  try {
    const a = new AudioContext(), o = a.createOscillator(), g = a.createGain();
    o.frequency.value = 880; g.gain.value = 0.08; o.connect(g); g.connect(a.destination);
    o.start(); o.stop(a.currentTime + 0.09); o.onended = () => a.close();
  } catch { /* sans son */ }
}

// ------------------------------------------------------------ résultat
function found(hit) {
  lastKey = hit.key;
  beep();
  if (auto.on) { addCard(hit.card, 1); unfreeze(true); return; }
  pending = { ...hit, qty: 1 };
  paused = true;
  renderResult();
}

const label = c => (state.lang === "fr" ? c.fr?.name || c.printed_name || c.name : c.name);

function renderResult() {
  const el = $("#scanResult");
  if (!pending) { el.innerHTML = ""; el.hidden = true; return; }
  const c = pending.card;
  el.hidden = false;
  el.innerHTML = `${cImgS(c) ? `<img src="${esc(cImgS(c))}" alt="">` : ""}
    <div class="sr-info"><b>${esc(label(c))}</b>
      <select class="small setpick" id="scanSet"><option value="${esc(c.set)}" data-name="${esc(c.set_name)}">${esc(c.set_name || c.set.toUpperCase())}${pending.how === "footer" || pending.how === "ai-exact" ? ` · n° ${esc(c.collector || "")}` : ""}</option></select>
      <small class="muted">${pending.how === "footer" ? t("scanExact") : pending.how === "ai-exact" ? t("scanAiExact") : pending.how === "ai" ? t("scanAiName") : t("scanByName")}</small>
      <div class="row"><button class="qb" data-q="-1">−</button><b id="scanQty">${pending.qty}</b><button class="qb" data-q="1">+</button>
        <button class="btn small" id="scanAdd">${t("add")}</button><button class="btn small ghost" id="scanSkip">${t("scanSkip")}</button></div></div>`;
  el.querySelectorAll("[data-q]").forEach(b => b.onclick = () => { pending.qty = Math.max(1, pending.qty + +b.dataset.q); $("#scanQty").textContent = pending.qty; });
  $("#scanAdd").onclick = () => {
    const sel = $("#scanSet"), opt = sel.selectedOptions[0];
    const card = sel.value && sel.value !== c.set ? { ...c, set: sel.value, set_name: opt?.dataset.name || "" } : c;
    addCard(card, pending.qty); pending = null; paused = false; renderResult(); unfreeze(true);
  };
  $("#scanSkip").onclick = () => { pending = null; paused = false; renderResult(); unfreeze(); };
  // autres impressions (si l'extension lue n'est pas la bonne, ou carte trouvée par son nom)
  const sel = $("#scanSet");
  sel.addEventListener("pointerdown", async () => {
    const list = await prints(c.name).catch(() => []);
    if (!list.length) return;
    sel.innerHTML = list.map(p => `<option value="${esc(p.set)}" data-name="${esc(p.set_name)}">${esc(p.set_name)} (${esc(p.set.toUpperCase())})</option>`).join("");
    sel.value = list.some(p => p.set === c.set) ? c.set : list[0].set;
  }, { once: true });
}

async function addCard(card, qty) {
  try {
    const { printed_name, lang, collector, ...data } = card;
    const total = await collectionService.addFromCatalog(data, qty);
    changed = true;
    const cur = state.collection.find(x => x.name === card.name);
    if (cur) cur.quantity = total; else state.collection.push({ ...data, quantity: total, reserved: [], free: total });
    const row = session.find(s => s.card.name === card.name && s.card.set === card.set);
    if (row) row.qty += qty; else session.unshift({ card: data, qty });
    renderSession();
    status(esc(t("added")(label(card), total)));
  } catch (e) { status(`⚠ ${esc(e.message)}`); }
}

function renderSession() {
  const n = session.reduce((a, s) => a + s.qty, 0);
  $("#scanList").innerHTML = session.length ? `<div class="muted small">${t("scanSession")(n)}</div>` + session.map((s, i) => `<div class="sl-row">
      ${cImgS(s.card) ? `<img src="${esc(cImgS(s.card))}" alt="">` : ""}<span>${s.qty}× ${esc(cName(s.card))} <small class="muted">${esc((s.card.set || "").toUpperCase())}</small></span>
      <button class="qb" data-undo="${i}" aria-label="−">−</button></div>`).join("") : "";
  $("#scanList").querySelectorAll("[data-undo]").forEach(b => b.onclick = async () => {
    const s = session[b.dataset.undo], cur = state.collection.find(x => x.name === s.card.name);
    if (!cur) return;
    const { quantity } = await collectionService.changeQuantity(cur, -1);
    cur.quantity = quantity;
    if (quantity <= 0) state.collection = state.collection.filter(x => x !== cur);
    if (--s.qty <= 0) session.splice(b.dataset.undo, 1);
    changed = true; renderSession();
  });
}

export function initScanner() {
  $("#scanClose").onclick = close;
  $("#scanSwitch").onclick = switchCamera;
  $("#scanTorch").onclick = toggleTorch;
  $("#scanAuto").onchange = e => { auto.on = e.target.checked; };
  $("#scanAi").onclick = askAi;
  $("#scanFreeze").onclick = toggleFreeze;
  // appui sur l'image = figer / reprendre (plus simple d'une main sur téléphone)
  $(".scanview").addEventListener("click", e => {
    if (e.target.closest("button, select, input, label, .scanresult, .scanstatus")) return;
    toggleFreeze();
  });
  $("#scanAiMode").onchange = e => { aiMode = e.target.checked; still = 0; lastSig = null; status(aiMode ? t("scanAimAi") : t("scanAim")); };
  // PC : Espace = demander à l'IA
  document.addEventListener("keydown", e => {
    if (e.code === "Space" && !$("#scanner").hidden && aiReady && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName || "")) { e.preventDefault(); askAi(); }
  });
  // PC : Entrée = figer / reprendre
  document.addEventListener("keydown", e => {
    if (e.key === "Enter" && !$("#scanner").hidden && !/INPUT|SELECT|TEXTAREA|BUTTON/.test(document.activeElement?.tagName || "")) { e.preventDefault(); toggleFreeze(); }
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#scanner").hidden) close(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden && !$("#scanner").hidden) close(); });
}

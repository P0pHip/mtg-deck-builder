// Scanner de cartes (à la ManaBox) : caméra → OCR local (Tesseract) → identification Scryfall → ajout à la collection.
// Le nom est lu dans le cartouche du haut ; sur les cartes récentes, le bas à gauche donne l'impression exacte.
import { prints } from "../../data/scryfall/index.js";
import { getSets } from "../../data/scryfall/sets.js";
import * as collectionService from "../../services/collectionService.js";
import { identify } from "../../services/scanService.js";
import { $, cImgS, cName, esc, spin } from "../dom.js";
import { state, t } from "../state.js";

// zones de la carte (en fractions du cadre 63×88) : cartouche du nom, et bas à gauche
const TITLE = { x: 0.05, y: 0.035, w: 0.72, h: 0.075 };
const FOOTER = { x: 0.03, y: 0.905, w: 0.5, h: 0.08 };
const PREF = "scanCamera";

let worker = null, workerLoading = null, PSM = null;
let stream = null, devices = [], deviceIdx = 0, running = false, paused = false, timer = null;
let knownSets = new Set(), pending = null, lastKey = null, emptyFrames = 0, candidate = null;
let session = [], changed = false, onClose = () => {};
const auto = { on: false };

const pref = { get: () => { try { return localStorage.getItem(PREF); } catch { return null; } }, set: v => { try { localStorage.setItem(PREF, v); } catch { /* sans stockage */ } } };

function status(html) { $("#scanStatus").innerHTML = html; }

export async function openScanner({ onClosed } = {}) {
  onClose = onClosed || (() => {});
  changed = false; session = []; pending = null; lastKey = null; candidate = null;
  $("#scanner").hidden = false;
  document.body.classList.add("noscroll");
  $("#scanAuto").checked = auto.on;
  renderResult(); renderSession();
  if (!navigator.mediaDevices?.getUserMedia) { status(`⚠ ${t("scanNoCam")}`); return; }
  getSets().then(m => { knownSets = new Set(m.keys()); }).catch(() => {});
  await startCamera();
  loadOcr();
}

async function close() {
  running = false; clearTimeout(timer);
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
  if (worker) { status(t("scanAim")); run(); }
}

async function switchCamera() {
  if (devices.length < 2) return;
  deviceIdx = (deviceIdx + 1) % devices.length;
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
  if (worker) { status(t("scanAim")); run(); return; }
  if (!workerLoading) {
    workerLoading = (async () => {
      const T = await import("tesseract.js");
      PSM = T.PSM;
      worker = await T.createWorker(["eng", "fra"], 1, {
        logger: m => { if (m.status && m.progress < 1 && !running) status(spin(`${t("scanLoading")} ${Math.round((m.progress || 0) * 100)} %`)); },
      });
    })().catch(e => { workerLoading = null; throw e; });
  }
  status(spin(t("scanLoading")));
  workerLoading.then(() => { if (stream) { status(t("scanAim")); run(); } })
    .catch(e => status(`⚠ ${t("scanOcrErr")} (${esc(e.message)})`));
}

/** Partie de l'image vidéo sous une zone du cadre de visée → canvas en niveaux de gris, contrasté, agrandi. */
function grab(zone) {
  const v = $("#scanVideo"), g = $("#scanGuide").getBoundingClientRect(), r = v.getBoundingClientRect();
  if (!v.videoWidth) return null;
  // la vidéo remplit son cadre (object-fit: cover) : on convertit les coordonnées écran → pixels vidéo
  const s = Math.max(r.width / v.videoWidth, r.height / v.videoHeight);
  const ox = (r.width - v.videoWidth * s) / 2, oy = (r.height - v.videoHeight * s) / 2;
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
  for (let i = 0; i < d.length; i += 4) {
    let y = (d[i] - min) / Math.max(1, max - min) * 255;
    if (invert) y = 255 - y;
    d[i] = d[i + 1] = d[i + 2] = y;
  }
  ctx.putImageData(img, 0, 0);
  return { canvas: c, sd };
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
    if (!paused && stream) {
      try { await scanFrame(); } catch (e) { console.warn("scan", e); }
    }
    timer = setTimeout(tick, 250);
  };
  tick();
}

async function scanFrame() {
  const title = grab(TITLE), footer = grab(FOOTER);
  if (!title || title.sd < 14) return noCard(); // rien de net dans le cadre
  const tr = await read(title.canvas, PSM.SINGLE_LINE), fr = await read(footer.canvas, PSM.SINGLE_BLOCK);
  if (!running || paused) return;
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
  if (auto.on) { addCard(hit.card, 1); return; }
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
      <select class="small setpick" id="scanSet"><option value="${esc(c.set)}" data-name="${esc(c.set_name)}">${esc(c.set_name || c.set.toUpperCase())}${pending.how === "footer" ? ` · n° ${esc(c.collector || "")}` : ""}</option></select>
      <small class="muted">${pending.how === "footer" ? t("scanExact") : t("scanByName")}</small>
      <div class="row"><button class="qb" data-q="-1">−</button><b id="scanQty">${pending.qty}</b><button class="qb" data-q="1">+</button>
        <button class="btn small" id="scanAdd">${t("add")}</button><button class="btn small ghost" id="scanSkip">${t("scanSkip")}</button></div></div>`;
  el.querySelectorAll("[data-q]").forEach(b => b.onclick = () => { pending.qty = Math.max(1, pending.qty + +b.dataset.q); $("#scanQty").textContent = pending.qty; });
  $("#scanAdd").onclick = () => {
    const sel = $("#scanSet"), opt = sel.selectedOptions[0];
    const card = sel.value && sel.value !== c.set ? { ...c, set: sel.value, set_name: opt?.dataset.name || "" } : c;
    addCard(card, pending.qty); pending = null; paused = false; renderResult();
  };
  $("#scanSkip").onclick = () => { pending = null; paused = false; renderResult(); };
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
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#scanner").hidden) close(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden && !$("#scanner").hidden) close(); });
}

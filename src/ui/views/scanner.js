// Scanner de cartes (à la ManaBox) : caméra → OCR local (Tesseract) → identification Scryfall → ajout à la collection.
// Le nom est lu dans le cartouche du haut ; sur les cartes récentes, le bas à gauche donne l'impression exacte.
// Mode « deck » (Mes decks → Scanner un deck) : les cartes vont dans une liste, pas dans la collection ; « Créer le deck »
// la passe à l'import de decklist (commandant, ce qui manque, ajout à la collection). La liste survit à la fermeture du scanner.
import { prints } from "../../data/scryfall/index.js";
import { getSets } from "../../data/scryfall/sets.js";
import * as collectionService from "../../services/collectionService.js";
import { identify, identifyFromAi } from "../../services/scanService.js";
import { checkWebGPU, errText } from "../../ai/capabilities.js";
import { readCardImage } from "../../ai/cardVision.js";
import { ensureEngine } from "../../ai/engine.js";
import { getStatus } from "../../ai/modelStore.js";
import { DEFAULT_MODEL, MODELS } from "../../ai/models.js";
import { $, armButton, cImgS, cName, esc, spin } from "../dom.js";
import { state, t } from "../state.js";

// zones de la carte (en fractions du cadre 63×88) : cartouche du nom, et bas à gauche
const TITLE = { x: 0.05, y: 0.035, w: 0.72, h: 0.075 };
// bas à gauche agrandi (numéro, rareté, extension, langue sur deux lignes) : c'est la lecture la plus sûre
const FOOTER = { x: 0.02, y: 0.88, w: 0.64, h: 0.11, px: 150 };
// cartouche élargi : sur une image figée, la carte n'est pas toujours bien alignée dans le cadre
const TITLE_WIDE = { x: 0.02, y: 0.015, w: 0.8, h: 0.115 };
const PREF = "scanCamera";

let worker = null, workerLoading = null, PSM = null;
let stream = null, devices = [], deviceIdx = 0, running = false, paused = false, timer = null;
let knownSets = new Set(), pending = null, lastKey = null, emptyFrames = 0, candidate = null;
let session = [], changed = false, onClose = () => {};
let deckMode = null, deckSession = []; // mode deck : { onDone(liste) } ; cartes scannées (gardées jusqu'à « Créer le deck »)
const auto = { on: false };
const model = MODELS[DEFAULT_MODEL];
let aiReady = false, aiBusy = false, aiMode = false, still = 0, lastSig = null;
let burst = (() => { try { return localStorage.getItem("scanBurst") === "1"; } catch { return false; } })();
let foil = false;    // les cartes ajoutées sont foil (case ✨ du scanner)
let doneSig = null; // image de la dernière carte traitée (modes auto) : on ne la relit pas tant qu'elle est là
let frozen = false; // image figée (« photo » non enregistrée) : la lecture se fait sur cette image, sans flou de bouger

const pref = { get: () => { try { return localStorage.getItem(PREF); } catch { return null; } }, set: v => { try { localStorage.setItem(PREF, v); } catch { /* sans stockage */ } } };

function status(html) { $("#scanStatus").innerHTML = html; }
/** Consigne selon le mode : IA auto, rafale, ou lecture continue. */
const aim = () => t(aiMode ? "scanAimAi" : burst ? "scanAimBurst" : "scanAim");

/** `deck` : { onDone(cartes scannées) } pour scanner un deck existant au lieu d'ajouter à la collection. */
export async function openScanner({ onClosed, deck = null } = {}) {
  onClose = onClosed || (() => {});
  deckMode = deck;
  changed = false; session = deck ? deckSession : []; pending = null; lastKey = null; candidate = null; doneSig = null;
  $("#scanTitle").textContent = t(deck ? "scanDeckTitle" : "scanTitle");
  for (const [id, key] of [["scanFocus", "scanFocusTip"], ["scanTorch", "scanTorchTip"], ["scanSwitch", "scanSwitchTip"], ["scanAi", "scanAiBtn"]]) {
    $(`#${id}`).title = $(`#${id}`).ariaLabel = t(key); // boutons ronds : le texte en bulle d'aide
  }
  $("#scanner").hidden = false;
  document.body.classList.add("noscroll");
  $("#scanAuto").checked = auto.on;
  $("#scanBurst").checked = burst;
  $("#scanFoil").checked = foil;
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
  $("#scanFocus").hidden = !caps.focusMode?.length;
  // mise au point continue quand la caméra le permet (sinon certaines restent réglées sur l'infini)
  if (caps.focusMode?.includes("continuous")) stream.getVideoTracks()[0].applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {});
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

/** 🎯 : relance la mise au point (une fois, puis retour à la mise au point continue). */
async function refocus() {
  const track = stream?.getVideoTracks()[0];
  const modes = track?.getCapabilities?.().focusMode || [];
  if (!modes.length) return;
  navigator.vibrate?.(20);
  status(t("scanFocusing"));
  try {
    if (modes.includes("single-shot")) await track.applyConstraints({ advanced: [{ focusMode: "single-shot" }] });
    else if (modes.includes("manual")) await track.applyConstraints({ advanced: [{ focusMode: "manual" }] }); // coupe le continu…
    if (modes.includes("continuous")) {
      await new Promise(r => setTimeout(r, 800));
      await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }); // … et le relance : nouvelle mise au point
    }
  } catch { /* caméra qui refuse le réglage */ }
  if (!frozen && !pending) status(aim());
}

let torch = false;
async function toggleTorch() {
  torch = !torch;
  await stream?.getVideoTracks()[0]?.applyConstraints({ advanced: [{ torch }] }).catch(() => { torch = false; });
}

// ------------------------------------------------------------ OCR
function loadOcr() {
  if (worker) { status(aim()); return; }
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
  workerLoading.then(() => { if (stream && !aiMode && !pending) status(aim()); })
    .catch(e => status(`⚠ ${t("scanOcrErr")} (${esc(e.message)})`));
}

/** Image à lire : la vidéo, en direct ou en pause (image figée : c'est exactement l'image affichée). */
function source() {
  const v = $("#scanVideo");
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
  const scale = Math.min(4, Math.max(1, (zone.px || 90) / sh)); // ~90 px de haut par ligne pour l'OCR
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
    status(`⚠ ${t("scanAiErr")} (${esc(errText(e))})`);
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
      try { aiMode ? aiFrame() : burst ? burstFrame() : await scanFrame(); } catch (e) { console.warn("scan", e); }
    }
    timer = setTimeout(tick, 250);
  };
  tick();
}

// ------------------------------------------------------------ image figée
/**
 * Fige l'image de la caméra (rien n'est enregistré) et la lit tranquillement, sans flou de bouger.
 * On met la vidéo en pause plutôt que d'afficher une copie par-dessus : sur certains Android, la copie
 * n'était pas cadrée comme la vidéo (l'image semblait zoomer toute seule).
 */
async function freeze() {
  const v = $("#scanVideo");
  if (frozen || !stream || !v.videoWidth || aiBusy) return;
  v.pause();
  frozen = true; candidate = null; lastKey = null;
  $("#scanFrozenBadge").hidden = false;
  renderFreezeHint();
  navigator.vibrate?.(30);
  if (pending) return; // une carte attend déjà d'être ajoutée
  if (aiMode && aiReady) return askAi();
  await scanFrozen();
}

/** Relance la caméra en direct. `silent` : sans message (ouverture, fermeture, changement de caméra). */
function unfreeze(silent = false) {
  const was = frozen;
  frozen = false;
  if (was && stream) $("#scanVideo").play().catch(() => {});
  $("#scanFrozenBadge").hidden = true;
  renderFreezeHint();
  if (was && !silent && !pending) status(aim());
}

const toggleFreeze = () => (frozen ? unfreeze() : freeze());

/** Petit bouton sous la mise au point : ⏸ (figer) ou ▶ (reprendre). */
function renderFreezeHint() {
  const el = $("#scanPause");
  el.textContent = frozen ? "▶︎" : "❚❚"; // symboles simples : Android affichait ⏸ en gros emoji orange
  el.title = frozen ? t("scanResume") : t("scanFreeze");
  el.setAttribute("aria-label", el.title);
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
  if (burst) {
    // rafale : on relance la caméra, sans réessayer tant que la carte n'a pas bougé
    lastKey = "miss";
    setTimeout(() => { if (frozen && !pending) unfreeze(true); }, 1500);
  }
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
/**
 * Détection d'une carte immobile dans le cadre : `action` est lancée une fois quand la carte ne bouge plus depuis
 * `ticks` images (×250 ms), puis plus rien tant que la carte n'a pas changé ou quitté le cadre (lastKey).
 */
function stillFrame(action, ticks, aimText) {
  const canvas = grabCard();
  if (!canvas) return;
  const sig = signature(canvas);
  if (sigSpread(sig) < 12) { lastSig = sig; still = 0; lastKey = null; doneSig = null; return; } // cadre vide
  const prev = lastSig;
  lastSig = sig;
  if (!prev) return; // première image : rien à comparer
  if (sigDiff(sig, prev) > 6) { still = 0; lastKey = null; status(t(aimText)); return; } // carte changée ou en mouvement
  // une carte déjà traitée reste dans le cadre (bruit de l'image, mise au point…) : pas de deuxième lecture
  const same = doneSig && sigDiff(sig, doneSig) < 14;
  if (++still === ticks && !lastKey && !same) { doneSig = sig; action(); }
}

/** Mode IA : dès que la carte reste immobile dans le cadre (~1 s), on la montre à l'IA. */
function aiFrame() {
  if (!aiBusy) stillFrame(askAi, 4, "scanAimAi");
}

/** Mode rafale : carte immobile (~0,75 s) → image figée, lue, ajoutée ; puis on attend la carte suivante. */
function burstFrame() {
  if (worker) stillFrame(freeze, 3, "scanAimBurst");
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
  if (auto.on || burst) { addCard(hit.card, 1); unfreeze(true); return; }
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
    // autre extension choisie à la main : numéro et prix de l'impression lue ne valent plus
    const card = sel.value && sel.value !== c.set ? { ...c, set: sel.value, set_name: opt?.dataset.name || "", collector: "", price_eur: null, price_foil: null } : c;
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

const sessionCount = () => session.reduce((a, s) => a + s.qty, 0);

/** Mode deck : la carte rejoint la liste du deck (même impression et finition = même ligne). */
function addToDeck(card, qty) {
  const row = session.find(s => s.card.name === card.name && s.card.set === card.set && s.foil === foil);
  if (row) row.qty += qty; else session.unshift({ card, qty, foil });
  renderSession();
  status(esc(t("scanDeckAdded")(label(card), sessionCount())));
}

async function addCard(card, qty) {
  if (deckMode) { addToDeck(card, qty); return; }
  try {
    // l'exemplaire garde l'impression lue (extension, numéro, langue) et la finition choisie (✨ foil)
    const total = await collectionService.addFromCatalog(card, qty, { foil });
    changed = true;
    const fresh = await collectionService.getCard(card.name), i = state.collection.findIndex(x => x.name === card.name);
    if (i >= 0) state.collection[i] = { ...state.collection[i], copies: fresh.copies, quantity: fresh.quantity };
    else state.collection.push({ ...fresh, reserved: [], free: total });
    const row = session.find(s => s.card.name === card.name && s.card.set === card.set && s.foil === foil);
    if (row) row.qty += qty; else session.unshift({ card, qty, foil });
    renderSession();
    status(esc(t("added")(label(card), total)));
  } catch (e) { status(`⚠ ${esc(e.message)}`); }
}

function renderSession() {
  const n = sessionCount();
  const head = deckMode
    ? `<div class="row wrap gap scandeck"><b>${t("scanDeckCount")(n)}</b>${n ? `<button class="btn small" id="scanDeckDone">${t("scanDeckDone")}</button>
        <button class="btn small ghost" id="scanDeckClear">${t("scanDeckClear")}</button>` : `<span class="muted small">${t("scanDeckHint")}</span>`}</div>`
    : session.length ? `<div class="muted small">${t("scanSession")(n)}</div>` : "";
  $("#scanList").innerHTML = head + session.map((s, i) => `<div class="sl-row">
      ${cImgS(s.card) ? `<img src="${esc(cImgS(s.card))}" alt="">` : ""}<span>${s.qty}× ${esc(cName(s.card))}${s.foil ? " ✨" : ""} <small class="muted">${esc((s.card.set || "").toUpperCase())}${s.card.lang && s.card.lang !== "en" ? " · " + esc(s.card.lang.toUpperCase()) : ""}</small></span>
      <button class="qb" data-undo="${i}" aria-label="−">−</button>${deckMode ? `<button class="qb" data-more="${i}" aria-label="+">+</button>` : ""}</div>`).join("");
  if (deckMode) {
    // terrains de base, cartes en plusieurs exemplaires : un scan, puis + autant de fois qu'il faut
    $("#scanList").querySelectorAll("[data-more]").forEach(b => b.onclick = () => { session[b.dataset.more].qty++; renderSession(); });
    $("#scanList").querySelectorAll("[data-undo]").forEach(b => b.onclick = () => {
      if (--session[b.dataset.undo].qty <= 0) session.splice(b.dataset.undo, 1);
      renderSession();
    });
    if ($("#scanDeckDone")) $("#scanDeckDone").onclick = finishDeck;
    if ($("#scanDeckClear")) armButton($("#scanDeckClear"), () => { session.splice(0); renderSession(); status(aim()); }, () => t("confirm"));
    return;
  }
  $("#scanList").querySelectorAll("[data-undo]").forEach(b => b.onclick = async () => {
    const s = session[b.dataset.undo], cur = state.collection.find(x => x.name === s.card.name);
    if (!cur) return;
    // annule exactement l'exemplaire scanné (même extension et finition)
    const quantity = await collectionService.removeFromSet(s.card.name, s.card.set, 1, s.foil);
    cur.quantity = quantity;
    if (quantity <= 0) state.collection = state.collection.filter(x => x !== cur);
    if (--s.qty <= 0) session.splice(b.dataset.undo, 1);
    changed = true; renderSession();
  });
}

/** « Créer le deck » : la liste (dans l'ordre du scan) part à l'import de decklist ; le scanner repart d'une liste vide. */
async function finishDeck() {
  const list = [...session].reverse();
  const done = deckMode.onDone;
  deckSession = [];
  await close();
  done(list);
}

export function initScanner() {
  $("#scanClose").onclick = close;
  $("#scanSwitch").onclick = switchCamera;
  $("#scanTorch").onclick = toggleTorch;
  $("#scanFocus").onclick = refocus;
  $("#scanPause").onclick = () => toggleFreeze();
  $("#scanAuto").onchange = e => { auto.on = e.target.checked; };
  $("#scanFoil").onchange = e => { foil = e.target.checked; };
  $("#scanBurst").onchange = e => {
    burst = e.target.checked;
    try { localStorage.setItem("scanBurst", burst ? "1" : "0"); } catch { /* sans stockage */ }
    still = 0; lastSig = null; lastKey = null;
    status(aim());
  };
  $("#scanAi").onclick = askAi;
  // appui sur l'image = figer / reprendre (plus simple d'une main sur téléphone)
  $(".scanview").addEventListener("click", e => {
    if (e.target.closest("button, select, input, label, .scanresult, .scanstatus")) return;
    toggleFreeze();
  });
  $("#scanAiMode").onchange = e => { aiMode = e.target.checked; still = 0; lastSig = null; status(aim()); };
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

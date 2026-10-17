// « ♾️ Base des combos » (Plus, et sous ♾️ Combos quand Commander Spellbook refuse la recherche en ligne) :
// téléchargement, mise à jour et suppression de la base gardée sur l'appareil, comme le modèle de l'IA.
// Un seul téléchargement à la fois ; chaque affichage montre sa progression (barres « .cbBar », textes « .cbMsg »).
import { requestPersistence } from "../../ai/capabilities.js";
import * as comboBase from "../../data/comboBase.js";
import { $, $$, armButton, esc, fmtBytes, msg } from "../dom.js";
import { t } from "../state.js";

let job = null; // { ctl, pct, count, promise }
const views = new Set(); // affichages ouverts : { el, opts }, redessinés au début et à la fin du téléchargement

function paint() {
  if (!job) return;
  $$(".cbBar").forEach(b => { b.style.width = `${(job.pct * 100).toFixed(1)}%`; });
  $$(".cbMsg").forEach(m => { m.textContent = t("cbProgress")(Math.round(job.pct * 100), job.count.toLocaleString()); });
}

const redrawAll = () => views.forEach(v => (v.el.isConnected ? draw(v) : views.delete(v)));

function start() {
  if (job) return job.promise;
  const ctl = new AbortController();
  job = { ctl, pct: 0, count: 0 };
  job.promise = (async () => {
    await requestPersistence(); // évite que le navigateur efface la base s'il manque de place
    try {
      return await comboBase.downloadComboBase({ signal: ctl.signal, onProgress: (pct, count) => { job.pct = pct; job.count = count; paint(); } });
    } finally {
      job = null;
      redrawAll();
    }
  })();
  redrawAll();
  return job.promise;
}

async function draw(v) {
  const { el, opts } = v;
  if (!comboBase.comboBaseSupported()) { el.innerHTML = `<p class="muted small">${t("cbUnsupported")}</p>`; return; }
  if (job) {
    el.innerHTML = `<div class="progress"><i class="cbBar"></i></div><div class="msg cbMsg"></div>
      <button class="btn ghost ${opts.compact ? "small" : "full"}" data-cb="cancel">${t("cbCancel")}</button>`;
    paint();
    el.querySelector("[data-cb=cancel]").onclick = () => job?.ctl.abort();
    return;
  }
  const info = await comboBase.comboBaseInfo().catch(() => null);
  if (job) return draw(v); // téléchargement lancé pendant la lecture
  const size = fmtBytes(comboBase.COMBO_DOWNLOAD_BYTES);
  if (info) {
    const date = new Date(info.source || info.at).toLocaleDateString();
    el.innerHTML = `<p class="msg ok">${t("cbReady")(date, info.count.toLocaleString(), fmtBytes(info.bytes))}</p>
      ${opts.compact ? "" : `<button class="btn full" data-cb="update">${t("cbUpdate")(size)}</button>
      <button class="btn danger full" data-cb="delete">${t("cbDelete")}</button>`}<div class="msg" data-cb="msg"></div>`;
  } else {
    el.innerHTML = `<button class="btn ${opts.compact ? "small" : "full"}" data-cb="download">${t("cbDownload")(size)}</button>
      <p class="muted small">${t("cbWifi")}</p><div class="msg" data-cb="msg"></div>`;
  }
  const go = el.querySelector("[data-cb=download], [data-cb=update]");
  if (go) go.onclick = () => run(v);
  const del = el.querySelector("[data-cb=delete]");
  if (del) armButton(del, async () => { await comboBase.removeComboBase(); redrawAll(); opts.onChange?.(); }, () => t("confirm"));
}

async function run(v) {
  try {
    await start();
    v.opts.onChange?.();
    if (v.el.isConnected) await v.opts.onReady?.();
  } catch (e) {
    if (e.name === "AbortError") return;
    const m = v.el.querySelector("[data-cb=msg]");
    const cut = e.name === "TypeError" || e.message === "truncated"; // réseau coupé (pendant ou avant le téléchargement)
    if (m) msg(m, esc(t("cbError")(cut ? t("cbNoNet") : e.message)), "err");
  }
}

/**
 * Affiche les commandes de la base dans `el`. `compact` : bouton seul (sous ♾️ Combos) ;
 * `onReady` : appelé quand la base vient d'être téléchargée depuis cet affichage ; `onChange` : base ajoutée ou supprimée.
 */
export function comboBaseControls(el, opts = {}) {
  if (!el) return;
  for (const v of views) if (v.el === el || !v.el.isConnected) views.delete(v);
  const v = { el, opts };
  views.add(v);
  draw(v);
}

/** Section de l'onglet Plus. */
export const renderComboBase = onChange => comboBaseControls($("#comboBaseBox"), { onChange });

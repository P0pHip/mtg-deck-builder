// Petits utilitaires d'affichage partagés par les vues.
import { BASICS_FR } from "../core/cards.js";
import { state } from "./state.js";

export const $ = s => document.querySelector(s);
export const $$ = s => [...document.querySelectorAll(s)];
export const esc = s => (s ?? "").toString().replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const norm = s => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
export const spin = text => `<span class="spin"></span>${text}`;
export function msg(el, html, kind = "") { el.className = "msg " + kind; el.innerHTML = html; }

export const fmtBytes = b => {
  const [g, m] = state.lang === "fr" ? ["Go", "Mo"] : ["GB", "MB"];
  return b >= 1e9 ? (b / 1e9).toFixed(2) + " " + g : (b / 1e6).toFixed(0) + " " + m;
};

// --- cartes dans la langue choisie
const fr = c => (state.lang === "fr" && c?.fr ? c.fr : null);
export const cName = c => fr(c)?.name || (state.lang === "fr" && BASICS_FR[c.name]) || c.name;
export const cType = c => fr(c)?.type_line || c.type_line;
export const cText = c => fr(c)?.text || c.oracle_text;
export const cImg = c => fr(c)?.image || c.image;
export const cImgS = c => fr(c)?.image_small || c.image_small || cImg(c);
export const cBack = c => fr(c)?.image_back || c.image_back;
export const dfc = c => (cBack(c) ? '<span class="dfc">⇄</span>' : "");
export const pips = cost => (cost || "")
  .replace(/\{([WUBRG])\}/g, '<span class="pip $1">$1</span>')
  .replace(/\{([^}]+)\}/g, '<span class="pip C">$1</span>');
/** Nom affiché d'une carte connue par son nom anglais. */
export const cNameOf = n => {
  const c = state.collection.find(x => x.name === n);
  return c ? cName(c) : (state.lang === "fr" && BASICS_FR[n]) || n;
};
export const identityPips = id => id.map(c => `<span class="pip ${c}">${c}</span>`).join("") || '<span class="pip C">C</span>';

/** Bouton à confirmer par un second appui (pas de popup bloquante). */
export function armButton(btn, action, confirmLabel) {
  btn.onclick = async () => {
    if (!btn.classList.contains("armed")) {
      btn.classList.add("armed"); btn.dataset.label = btn.textContent; btn.textContent = confirmLabel();
      setTimeout(() => {
        if (btn.isConnected && btn.classList.contains("armed")) { btn.classList.remove("armed"); btn.textContent = btn.dataset.label; }
      }, 3000);
      return;
    }
    btn.classList.remove("armed");
    await action();
  };
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return; } catch { /* repli ci-dessous */ }
  const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta);
  ta.select(); document.execCommand("copy"); ta.remove();
}

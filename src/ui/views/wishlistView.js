// Liste d'envies : cartes à acheter, total, prix cible (alertes), copie pour Cardmarket, export CSV, et ce que j'ai déjà.
import * as core from "../../core/index.js";
import * as wishlistService from "../../services/wishlistService.js";
import { $, $$, armButton, cImgS, cName, copyText, downloadText, esc, msg, spin } from "../dom.js";
import { openSheet } from "../sheet.js";
import { state, t } from "../state.js";

let order = "price";
const owned = () => Object.fromEntries(state.collection.map(c => [c.name, c.quantity]));

export async function openWishlist() {
  $("#wishPanel").hidden = false;
  document.body.classList.add("noscroll");
  await render();
  refreshPrices(false); // prix relus une fois par jour, en arrière-plan
}

/** Relit les prix (tous les jours à l'ouverture, ou à la demande) puis redessine. */
async function refreshPrices(force) {
  if (force) msg($("#wlMsg"), spin(t("wishPricing")));
  try {
    const done = await wishlistService.refreshPrices({ force });
    if (!done) { if (force) msg($("#wlMsg"), ""); return; }
    if ($("#wishPanel").hidden) return;
    await render();
    msg($("#wlMsg"), t("wishPriced"), "ok");
  } catch (e) {
    if (force) msg($("#wlMsg"), `${t("netErr")}${esc(e.message)}`, "err");
  }
}

function close() {
  $("#wishPanel").hidden = true;
  document.body.classList.remove("noscroll");
}

/** Bouton ⭐ de la collection : nombre d'envies. */
export async function updateWishButton(list = null) {
  list ||= await wishlistService.wishlist();
  const alerts = core.priceAlerts(list, owned()).length;
  $("#wishBtn").textContent = t("wishBtn")(list.length) + (alerts ? ` · 🔔 ${alerts}` : "");
  $("#wishBtn").title = alerts ? t("wishAlerts")(alerts) : "";
}

async function render() {
  const list = await wishlistService.wishlist(), have = owned();
  const sorters = {
    price: (a, b) => (b.price_eur || 0) - (a.price_eur || 0) || a.name.localeCompare(b.name),
    name: (a, b) => cName(a).localeCompare(cName(b)),
    added: (a, b) => (b.added || "").localeCompare(a.added || ""),
  };
  const rows = [...list].sort(sorters[order]);
  const missing = rows.reduce((a, w) => a + core.stillMissing(w, have), 0);
  const total = core.wishTotal(list, have);
  const ownedCount = list.filter(w => !core.stillMissing(w, have)).length;
  const alerts = new Set(core.priceAlerts(list, have).map(w => w.name));
  const at = await wishlistService.pricesAt();
  const arrow = w => (w.price_prev == null ? "" : w.price_eur < w.price_prev
    ? ` <span class="pdown" title="${esc(t("wishWas")(w.price_prev))}">↓</span>` : ` <span class="pup" title="${esc(t("wishWas")(w.price_prev))}">↑</span>`);

  $("#wlBody").innerHTML = !list.length ? `<div class="empty">${t("wishEmpty")}</div>` : `
    <div class="stats"><div class="stat"><b>${list.length}</b><span>${t("cards")}</span></div>
      <div class="stat"><b>${missing}</b><span>${t("wishToBuy")}</span></div>
      <div class="stat"><b>${total.toFixed(2)} €</b><span>${t("wishTotalLabel")}</span></div></div>
    ${alerts.size ? `<div class="msg ok">🔔 ${t("wishAlerts")(alerts.size)}</div>` : ""}
    <div class="row between wrap"><select class="small" id="wlOrder">${["price", "name", "added"].map(k => `<option value="${k}" ${k === order ? "selected" : ""}>${t("wishOrder")[k]}</option>`).join("")}</select>
      ${ownedCount ? `<button class="btn small ghost" id="wlOwned">${t("wishDropOwned")(ownedCount)}</button>` : ""}
      <button class="btn small ghost" id="wlPrices" title="${esc(t("wishPricesTip"))}">🔄 ${at ? t("wishPricesOf")(new Date(at).toLocaleDateString(state.lang, { day: "numeric", month: "short" })) : t("wishPricesNow")}</button></div>
    <p class="muted small">${t("wishTargetHelp")}</p>
    <div class="wlist">${rows.map((w, i) => {
      const n = have[w.name] || 0, left = core.stillMissing(w, have);
      return `<div class="crow ${alerts.has(w.name) ? "alert" : ""}" data-i="${i}">
        ${cImgS(w) ? `<img loading="lazy" src="${esc(cImgS(w))}" alt="">` : '<div class="noimg"></div>'}
        <div class="ci"><b>${esc(cName(w))}</b>
          <small>${w.price_eur != null ? `${w.price_eur} €${arrow(w)}` : t("noPrice")}${w.set ? ` · ${esc(w.set.toUpperCase())}` : ""}${w.sources?.length ? ` · ${esc(w.sources.join(", "))}` : ""}</small>
          ${n ? `<small class="${left ? "res" : "free"}">${left ? t("wishPartly")(n, w.count) : t("wishGot")(n)}</small>` : ""}
          ${alerts.has(w.name) ? `<small class="free">🔔 ${t("wishUnder")(w.target)}</small>` : ""}</div>
        <input type="number" class="wtarget" inputmode="decimal" min="0" step="0.5" value="${w.target ?? ""}" placeholder="🎯 €"
          title="${esc(t("wishTargetTip"))}" aria-label="${esc(t("wishTargetTip"))}">
        <div class="qty"><button class="qb" data-d="-1" aria-label="−">−</button><b>${w.count}</b><button class="qb" data-d="1" aria-label="+">+</button></div></div>`;
    }).join("")}</div>
    <div class="row wrap gap"><button class="btn small" id="wlCopy">${t("wishCopy")}</button>
      <button class="btn small ghost" id="wlCsv">⬇ CSV</button>
      <button class="btn small danger" id="wlClear">${t("wishClear")}</button></div>
    <p class="muted small">${t("wishCopyHelp")}</p>
    <div class="msg" id="wlMsg"></div>`;
  if (!list.length) return;

  $("#wlOrder").onchange = () => { order = $("#wlOrder").value; render(); };
  $("#wlPrices").onclick = () => refreshPrices(true);
  if ($("#wlOwned")) $("#wlOwned").onclick = async () => {
    const n = await wishlistService.removeOwned(state.collection);
    await render(); msg($("#wlMsg"), t("wishDropped")(n), "ok");
  };
  $$("#wlBody .crow").forEach(row => {
    const w = rows[row.dataset.i];
    row.querySelectorAll(":scope > img, :scope > .noimg, .ci").forEach(x => { x.onclick = () => openSheet(w); });
    row.querySelectorAll(".qb").forEach(b => b.onclick = async () => { await wishlistService.setCount(w.name, w.count + +b.dataset.d); render(); });
    row.querySelector(".wtarget").onchange = async e => { await wishlistService.setTarget(w.name, parseFloat(e.target.value.replace(",", ".")) || null); render(); };
  });
  // à copier : seulement ce qui manque encore (format « 2 Sol Ring », accepté par Cardmarket, Moxfield…)
  const toBuy = rows.map(w => [core.stillMissing(w, have), w]).filter(([n]) => n > 0);
  $("#wlCopy").onclick = async () => { await copyText(toBuy.map(([n, w]) => `${n} ${w.name}`).join("\n")); $("#wlCopy").textContent = t("copied"); };
  $("#wlCsv").onclick = () => downloadText(`envies-${new Date().toISOString().slice(0, 10)}.csv`, core.toCSV(toBuy.map(([, w]) => w), w => core.stillMissing(w, have)));
  armButton($("#wlClear"), async () => { await wishlistService.clear(); render(); }, () => t("confirm"));
}

/** Bouton « ⭐ Ajouter à mes envies » réutilisable : `items()` → [{ card, count }]. */
export function bindWishButton(btn, items, source = "") {
  btn.onclick = async () => {
    const list = items();
    if (!list.length) return;
    await wishlistService.addWishes(list, source);
    btn.textContent = t("wishAdded")(list.length);
    btn.disabled = true;
  };
}

export function initWishlist() {
  $("#wlClose").onclick = close;
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#wishPanel").hidden && $("#sheet").hidden) close(); });
  wishlistService.onWishlistChange(list => updateWishButton(list));
}

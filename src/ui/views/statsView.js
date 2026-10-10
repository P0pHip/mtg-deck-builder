// Statistiques de la collection : valeur (et son évolution), répartitions, cartes les plus chères, doubles, export CSV.
import * as core from "../../core/index.js";
import { fallbackIcon, getSets } from "../../data/scryfall/sets.js";
import * as statsService from "../../services/statsService.js";
import { $, $$, cImgS, cName, copyText, esc, msg, spin } from "../dom.js";
import { openSheet } from "../sheet.js";
import { state, t } from "../state.js";

let keep = 4, sets = new Map(), onChanged = async () => {};
const euro = v => `${Math.round(v).toLocaleString(state.lang)} €`;

export async function openStats({ onPricesUpdated } = {}) {
  onChanged = onPricesUpdated || (async () => {});
  $("#statsPanel").hidden = false;
  document.body.classList.add("noscroll");
  $("#stBody").innerHTML = `<div class="msg">${spin("")}</div>`;
  sets = await getSets().catch(() => new Map());
  render();
}

function close() {
  $("#statsPanel").hidden = true;
  document.body.classList.remove("noscroll");
}

async function render() {
  const col = state.collection, s = core.collectionStats(col);
  const history = await statsService.recordToday(col), at = await statsService.pricesUpdatedAt();
  const colorLabel = k => (k === "L" ? `🏔️ ${t("types").Land}` : `<span class="pip ${k}">${k}</span> ${{ M: t("multicolor"), C: t("colorless") }[k] || t("colorNames")[k]}`);
  const setLabel = k => `<img class="ficon" src="${esc(sets.get(k)?.icon || fallbackIcon(k))}" alt="" onerror="this.remove()"> ${esc(sets.get(k)?.name || k.toUpperCase())}`;

  $("#stBody").innerHTML = `
    <div class="stats sttiles">
      <div class="stat"><b>${euro(s.value)}</b><span>${t("stValue")}</span></div>
      <div class="stat"><b>${s.cards}</b><span>${t("cards")}</span></div>
      <div class="stat"><b>${s.copies}</b><span>${t("copies")}</span></div>
      <div class="stat"><b>${s.reserved}</b><span>${t("stInDecks")}</span></div>
    </div>
    <div class="card"><h2>${t("stHistory")}</h2>${lineChart(history)}
      <div class="row between wrap"><span class="muted small">${at ? t("stPricesAt")(at) : t("stPricesOld")}</span>
        <button class="btn small ghost" id="stRefresh">${t("stRefresh")}</button></div><div class="msg" id="stMsg"></div></div>
    <div class="card"><h2>${t("stByColor")}</h2>${bars(s.byColor, colorLabel, k => k)}</div>
    <div class="card"><h2>${t("stByType")}</h2>${bars(s.byType, k => esc(t("types")[k] || k))}</div>
    <div class="card"><h2>${t("stBySet")}</h2>${bars(s.bySet.slice(0, 8), setLabel)}</div>
    <div class="card"><h2>${t("stTop")}</h2><div class="sttop">${s.topCards.map((c, i) => `<div class="sl-row" data-i="${i}">
      ${cImgS(c) ? `<img src="${esc(cImgS(c))}" alt="">` : ""}<span>${esc(cName(c))} <small class="muted">${esc((c.set || "").toUpperCase())}${c.quantity > 1 ? ` · ×${c.quantity}` : ""}</small></span><b>${c.price_eur} €</b></div>`).join("")}</div></div>
    <div class="card" id="stTrade"></div>
    <div class="card"><h2>${t("stExport")}</h2><p class="muted small">${t("stExportHelp")}</p>
      <button class="btn ghost full" id="stCsv">${t("stCsv")}</button></div>`;

  $$("#stBody .sttop .sl-row").forEach(r => { r.onclick = () => openSheet(s.topCards[r.dataset.i]); });
  $("#stRefresh").onclick = refreshPrices;
  $("#stCsv").onclick = () => download(`collection-${new Date().toISOString().slice(0, 10)}.csv`, core.toCSV(col));
  bindChart();
  renderTrade();
}

/** Barres horizontales : une seule mesure (valeur), étiquette et montant en clair ; `colorOf` = couleur de mana éventuelle. */
function bars(rows, label, colorOf = null) {
  const max = Math.max(1, ...rows.map(r => r.value));
  return `<div class="sbars">${rows.map(r => `<div class="sbar" title="${esc(`${r.value} € · ${r.copies} ${t("copies")} · ${r.cards} ${t("cards")}`)}">
    <span class="sl">${label(r.key)}</span>
    <span class="sb"><i class="${colorOf ? `mana ${colorOf(r.key)}` : ""}" style="width:${Math.max(1, r.value / max * 100)}%"></i></span>
    <span class="sv">${euro(r.value)}<small>${r.copies} ${t("copies")}</small></span></div>`).join("")}</div>`;
}

// ------------------------------------------------------------ évolution de la valeur
let chartPts = [], chartW = 600;
function lineChart(h) {
  if (h.length < 2) return `<p class="muted small">${t("stHistoryEmpty")}</p>`;
  // dessiné à la taille réelle (pas d'étirement : textes et points restent nets)
  const W = chartW = Math.max(260, ($("#stBody").clientWidth || 630) - 30), H = 170, L = 8, R = 8, T = 14, B = 22;
  const vals = h.map(x => x.value), lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.15 || hi * 0.05 || 1, y0 = Math.max(0, lo - pad), y1 = hi + pad;
  const t0 = Date.parse(h[0].date), t1 = Date.parse(h.at(-1).date) || t0 + 1;
  const X = d => L + (Date.parse(d) - t0) / Math.max(1, t1 - t0) * (W - L - R), Y = v => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  chartPts = h.map(x => ({ x: X(x.date), y: Y(x.value), ...x }));
  const line = chartPts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join("");
  const grid = [y0 + (y1 - y0) * 0.25, y0 + (y1 - y0) * 0.75].map(v => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="cgrid"/><text x="${L}" y="${Y(v) - 4}" class="clab">${euro(v)}</text>`).join("");
  const last = chartPts.at(-1);
  return `<div class="chart" id="stChart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t("stHistory"))}">
      ${grid}
      <path d="${line}L${last.x},${H - B}L${chartPts[0].x},${H - B}Z" class="carea"/>
      <path d="${line}" class="cline"/>
      <line id="stCross" class="ccross" y1="${T}" y2="${H - B}" x1="-10" x2="-10"/>
      <circle cx="${last.x}" cy="${last.y}" r="4" class="cdot"/>
      <text x="${L}" y="${H - 6}" class="clab">${esc(h[0].date)}</text><text x="${W - R}" y="${H - 6}" class="clab" text-anchor="end">${esc(last.date)}</text>
    </svg><div class="ctip" id="stTip" hidden></div></div>
    <div class="muted small">${t("stChange")(euro(last.value - h[0].value), h[0].date)}</div>`;
}

/** Survol / appui : réticule vertical et bulle (date, valeur) sur le relevé le plus proche. */
function bindChart() {
  const box = $("#stChart");
  if (!box) return;
  const svg = box.querySelector("svg"), tip = $("#stTip"), cross = $("#stCross");
  const show = e => {
    const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * chartW;
    const p = chartPts.reduce((a, b) => (Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a));
    cross.setAttribute("x1", p.x); cross.setAttribute("x2", p.x);
    tip.hidden = false;
    tip.innerHTML = `<b>${euro(p.value)}</b><br><small>${esc(p.date)} · ${p.copies} ${t("copies")}</small>`;
    const left = p.x / chartW * r.width;
    tip.style.left = `${Math.min(r.width - tip.offsetWidth, Math.max(0, left - tip.offsetWidth / 2))}px`;
  };
  svg.onpointermove = show;
  svg.onpointerdown = show;
  svg.onpointerleave = () => { tip.hidden = true; cross.setAttribute("x1", -10); cross.setAttribute("x2", -10); };
}

async function refreshPrices() {
  const btn = $("#stRefresh");
  btn.disabled = true;
  msg($("#stMsg"), spin(t("stRefreshing")));
  try {
    const r = await statsService.refreshPrices({ onProgress: (n, total) => msg($("#stMsg"), spin(`${t("stRefreshing")} ${n}/${total}`)) });
    await onChanged(); // recharge la collection avec les nouveaux prix
    await render();
    msg($("#stMsg"), t("stRefreshed")(r.changed), "ok");
  } catch (e) {
    msg($("#stMsg"), t("netErr") + e.message, "err");
    btn.disabled = false;
  }
}

// ------------------------------------------------------------ doubles à échanger
function renderTrade() {
  const list = core.tradeables(state.collection, keep);
  const total = list.reduce((a, x) => a + x.value, 0), copies = list.reduce((a, x) => a + x.extra, 0);
  $("#stTrade").innerHTML = `<h2>${t("stTrade")}</h2><p class="muted small">${t("stTradeHelp")}</p>
    <div class="row wrap"><span class="small muted">${t("stKeep")}</span>
      <div class="seg" id="stKeep">${[1, 2, 4].map(n => `<button data-k="${n}" class="${n === keep ? "on" : ""}">${n}</button>`).join("")}</div></div>
    <div class="small gap"><b>${copies}</b> ${t("copies")} · <b>${euro(total)}</b></div>
    <div class="sttop">${list.slice(0, 40).map(x => `<div class="sl-row">${cImgS(x.card) ? `<img src="${esc(cImgS(x.card))}" alt="">` : ""}
      <span>${x.extra}× ${esc(cName(x.card))} <small class="muted">${t("stOwnedOf")(x.card.quantity)}</small></span><b>${x.value ? x.value + " €" : ""}</b></div>`).join("")
      || `<div class="empty">${t("stNoTrade")}</div>`}</div>
    ${list.length > 40 ? `<div class="muted small center">${t("stMore")(list.length - 40)}</div>` : ""}
    ${list.length ? `<div class="row wrap gap"><button class="btn small ghost" id="stTradeCopy">${t("stCopyList")}</button>
      <button class="btn small ghost" id="stTradeCsv">${t("stCsvShort")}</button></div>` : ""}`;
  $$("#stKeep button").forEach(b => b.onclick = () => { keep = +b.dataset.k; renderTrade(); });
  if (!list.length) return;
  $("#stTradeCopy").onclick = async () => { await copyText(list.map(x => `${x.extra} ${x.card.name}`).join("\n")); $("#stTradeCopy").textContent = t("copied"); };
  const extra = new Map(list.map(x => [x.card.name, x.extra]));
  $("#stTradeCsv").onclick = () => download(`doubles-${new Date().toISOString().slice(0, 10)}.csv`, core.toCSV(list.map(x => x.card), c => extra.get(c.name)));
}

function download(name, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function initStats() {
  $("#stClose").onclick = close;
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#statsPanel").hidden && $("#sheet").hidden) close(); });
}

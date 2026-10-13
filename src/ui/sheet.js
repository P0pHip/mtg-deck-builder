// Fiche d'une carte (ouverte en appuyant sur son nom).
import { rulings } from "../data/scryfall/index.js";
import * as wishlistService from "../services/wishlistService.js";
import { $, cBack, cImg, cName, cText, cType, esc, msg, pips, spin } from "./dom.js";
import { renderCopies } from "./copiesEditor.js";
import { state, t } from "./state.js";

export function openSheet(c) {
  if (!c) return;
  const imgs = [cImg(c), cBack(c)].filter(Boolean).map(u => `<img src="${u}" alt="">`).join("");
  $("#sheetContent").innerHTML = `${imgs ? `<div class="imgs">${imgs}</div>` : ""}
    <h3>${esc(cName(c))}</h3><div>${pips(c.mana_cost)}</div>
    <div class="muted small">${esc(cType(c) || "")}</div>
    <p>${esc(cText(c) || "")}</p>
    <div class="muted small">${c.price_eur != null ? c.price_eur + " €" : ""}${c.edhrec_rank ? ` · EDHREC #${c.edhrec_rank}` : ""}</div>
    <div class="sheetcopies" id="sheetCopies"></div>
    <details class="rulings" id="sheetRulings"><summary>${t("rulingsTitle")}</summary><div id="sheetRulingsBody"></div></details>
    <button class="btn ghost full" id="sheetWish">${t("wishAddOne")}</button>
    ${c.scryfall_uri ? `<a class="btn ghost full" href="${c.scryfall_uri}" target="_blank" rel="noopener">Scryfall ↗</a>` : ""}`;
  // carte possédée : ses exemplaires (extension, langue, foil, état) se règlent ici
  const owned = state.collection.find(x => x.name === c.name);
  if (owned) renderCopies($("#sheetCopies"), owned);
  $("#sheetWish").onclick = async () => {
    await wishlistService.addWishes([{ card: c, count: 1 }]);
    $("#sheetWish").textContent = t("wishAdded")(1); $("#sheetWish").disabled = true;
  };
  // règles officielles : chargées seulement quand on ouvre la rubrique
  $("#sheetRulings").ontoggle = () => { if ($("#sheetRulings").open && !$("#sheetRulingsBody").dataset.done) showRulings(c.name); };
  $("#sheet").hidden = false;
}

async function showRulings(name) {
  const body = $("#sheetRulingsBody");
  body.innerHTML = `<div class="muted small">${spin(t("rulingsLoading"))}</div>`;
  try {
    const list = await rulings(name);
    if (!body.isConnected) return;
    body.dataset.done = "1";
    const date = d => (d ? new Date(d).toLocaleDateString(state.lang, { year: "numeric", month: "short", day: "numeric" }) : "");
    body.innerHTML = list.length
      ? `<div class="muted small">${t("rulingsNote")}</div>` + list.map(r => `<div class="ruling"><small class="muted">${date(r.date)}${r.source === "wotc" ? " · Wizards" : ""}</small><div>${esc(r.text)}</div></div>`).join("")
      : `<div class="muted small">${t("rulingsNone")}</div>`;
  } catch (e) {
    msg(body, t("rulingsErr")(esc(e.message)), "err");
  }
}

export function initSheet() {
  $("#sheetClose").onclick = () => { $("#sheet").hidden = true; };
  $("#sheet").onclick = e => { if (e.target.id === "sheet") $("#sheet").hidden = true; };
}

// Fiche d'une carte (ouverte en appuyant sur son nom).
import * as wishlistService from "../services/wishlistService.js";
import { $, cBack, cImg, cName, cText, cType, esc, pips } from "./dom.js";
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
    <button class="btn ghost full" id="sheetWish">${t("wishAddOne")}</button>
    ${c.scryfall_uri ? `<a class="btn ghost full" href="${c.scryfall_uri}" target="_blank" rel="noopener">Scryfall ↗</a>` : ""}`;
  // carte possédée : ses exemplaires (extension, langue, foil, état) se règlent ici
  const owned = state.collection.find(x => x.name === c.name);
  if (owned) renderCopies($("#sheetCopies"), owned);
  $("#sheetWish").onclick = async () => {
    await wishlistService.addWishes([{ card: c, count: 1 }]);
    $("#sheetWish").textContent = t("wishAdded")(1); $("#sheetWish").disabled = true;
  };
  $("#sheet").hidden = false;
}

export function initSheet() {
  $("#sheetClose").onclick = () => { $("#sheet").hidden = true; };
  $("#sheet").onclick = e => { if (e.target.id === "sheet") $("#sheet").hidden = true; };
}

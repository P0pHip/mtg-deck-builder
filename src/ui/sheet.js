// Fiche d'une carte (ouverte en appuyant sur son nom).
import { $, cBack, cImg, cName, cText, cType, esc, pips } from "./dom.js";

export function openSheet(c) {
  if (!c) return;
  const imgs = [cImg(c), cBack(c)].filter(Boolean).map(u => `<img src="${u}" alt="">`).join("");
  $("#sheetContent").innerHTML = `${imgs ? `<div class="imgs">${imgs}</div>` : ""}
    <h3>${esc(cName(c))}</h3><div>${pips(c.mana_cost)}</div>
    <div class="muted small">${esc(cType(c) || "")}</div>
    <p>${esc(cText(c) || "")}</p>
    <div class="muted small">${c.price_eur != null ? c.price_eur + " €" : ""}${c.edhrec_rank ? ` · EDHREC #${c.edhrec_rank}` : ""}</div>
    ${c.scryfall_uri ? `<a class="btn ghost full" href="${c.scryfall_uri}" target="_blank" rel="noopener">Scryfall ↗</a>` : ""}`;
  $("#sheet").hidden = false;
}

export function initSheet() {
  $("#sheetClose").onclick = () => { $("#sheet").hidden = true; };
  $("#sheet").onclick = e => { if (e.target.id === "sheet") $("#sheet").hidden = true; };
}

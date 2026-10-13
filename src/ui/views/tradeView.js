// Classeur d'échange reçu par lien : les doubles d'un ami, triés pour moi (ce que je cherche, ce que je n'ai pas, ce que j'ai déjà).
import * as core from "../../core/index.js";
import * as statsService from "../../services/statsService.js";
import * as wishlistService from "../../services/wishlistService.js";
import { $, $$, cImgS, cName, copyText, esc, msg, spin } from "../dom.js";
import { state, t } from "../state.js";

const euro = n => `${n.toFixed(2)} €`;

/** `shared` : { name, text } décodé du lien (…#trade=…). */
export async function openTradeOffer(shared) {
  const title = shared.name ? t("tradeOfferOf")(shared.name) : t("tradeOffer");
  $("#sheetContent").innerHTML = `<h3>📒 ${esc(title)}</h3><div id="toBody"><div class="msg">${spin(t("tradeReading"))}</div></div>`;
  $("#sheet").hidden = false;
  let offer;
  try {
    offer = await statsService.readTradeOffer(shared.text, { lang: state.lang });
  } catch (e) {
    msg($("#toBody"), `${t("netErr")}${esc(e.message)}`, "err");
    return;
  }
  render(offer);
}

async function render({ items, notFound }) {
  const wishes = await wishlistService.wishlist();
  const owned = Object.fromEntries(state.collection.map(c => [c.name, c.quantity]));
  const groups = core.sortTradeOffer(items, { wishes, owned });
  const value = l => l.reduce((a, it) => a + (it.card.price_eur || 0) * it.count, 0);
  const row = (it, canWish) => `<div class="sl-row">${cImgS(it.card) ? `<img src="${esc(cImgS(it.card))}" alt="">` : ""}
      <span>${it.count}× ${esc(cName(it.card))}</span><b>${it.card.price_eur != null ? euro(it.card.price_eur) : ""}</b>
      ${canWish ? `<button class="qb" data-wish="${esc(it.card.name)}" title="${esc(t("wishAddOne"))}" aria-label="${esc(t("wishAddOne"))}">⭐</button>` : ""}</div>`;
  const section = (key, list, canWish) => (list.length ? `<h4>${t("tradeGroups")[key](list.length)} <small class="muted">· ${euro(value(list))}</small></h4>
      <div class="sttop">${list.map(it => row(it, canWish)).join("")}</div>` : "");
  $("#toBody").innerHTML = `<p class="muted small">${t("tradeHelp")}</p>
    ${!groups.wanted.length ? `<div class="msg">${t("tradeNoWanted")}</div>` : ""}
    ${section("wanted", groups.wanted, false)}${section("missing", groups.missing, true)}${section("owned", groups.owned, false)}
    ${notFound.length ? `<p class="muted small">${t("notFound")}${esc(notFound.join(", "))}</p>` : ""}
    ${groups.wanted.length ? `<button class="btn small ghost" id="toCopy">${t("tradeCopy")}</button>` : ""}`;
  $$("#toBody [data-wish]").forEach(b => b.onclick = async () => {
    const it = items.find(x => x.card.name === b.dataset.wish);
    await wishlistService.addWishes([{ card: it.card, count: it.count }], t("tradeSource"));
    b.textContent = "✓"; b.disabled = true;
  });
  if ($("#toCopy")) $("#toCopy").onclick = async () => {
    await copyText(groups.wanted.map(it => `${it.count} ${it.card.name}`).join("\n"));
    $("#toCopy").textContent = t("copied");
  };
}

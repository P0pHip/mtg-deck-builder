// « 💶 Budget d'achat » (onglet Construire) : les meilleures cartes à acheter pour améliorer le deck, sans dépasser un budget.
// Rien n'est modifié dans le deck : les cartes proposées vont dans la liste d'envies (ou se copient pour Cardmarket).
import * as deckService from "../../services/deckService.js";
import { $, cImgS, cName, copyText, esc, msg, spin } from "../dom.js";
import { openSheet } from "../sheet.js";
import { state, t } from "../state.js";
import { bindWishButton } from "./wishlistView.js";

let budget = 20;

/** Nouveau deck (ou deck modifié) : les anciennes propositions ne valent plus. */
export function resetBudget() {
  if ($("#budgetBox")) $("#budgetBox").innerHTML = "";
}

function openForm() {
  const box = $("#budgetBox");
  if (box.innerHTML) { box.innerHTML = ""; return; } // second appui : on referme
  box.innerHTML = `<div class="upbox"><div class="row gap budgetform">
      <input type="number" id="budgetEur" min="1" step="5" inputmode="decimal" value="${budget}" aria-label="${esc(t("budgetLabel"))}"><span>€</span>
      <button class="btn small" id="budgetGo">${t("budgetGo")}</button></div>
    <div class="small muted">${t("budgetHelp")}</div><div id="budgetRes"></div></div>`;
  $("#budgetGo").onclick = propose;
  $("#budgetEur").onkeydown = e => { if (e.key === "Enter") propose(); };
}

async function propose() {
  budget = Math.max(1, parseFloat($("#budgetEur").value) || 20);
  const res = $("#budgetRes");
  res.innerHTML = `<div class="msg">${spin(t("budgetLooking"))}</div>`;
  let r;
  try { r = await deckService.budgetUpgrade(state.deck, budget, { useEdhrec: $("#useEdh").checked }); }
  catch (e) { msg(res, `${t("netErr")}${esc(e.message)}`, "err"); return; }
  if (!r.swaps.length) { res.innerHTML = `<div class="msg ok">${t("budgetNone")(budget)}</div>`; return; }
  const thumb = c => (cImgS(c) ? `<img src="${esc(cImgS(c))}" alt="">` : "");
  res.innerHTML = r.swaps.map((u, i) => `<div class="uprow nochk">
      <span class="upcard out" data-i="${i}" data-card="out">${thumb(u.out)}<span>− ${u.count > 1 ? `${u.count} ` : ""}${esc(cName(u.out))}</span></span>
      <span class="uparrow">→</span>
      <span class="upcard in" data-i="${i}" data-card="in">${thumb(u.in)}<span>+ ${esc(cName(u.in))}</span></span>
      <small class="upgain">${u.cost.toFixed(2)} €</small></div>`).join("")
    + `<div class="msg ok">${t("budgetSpent")(r.spent.toFixed(2), budget)}</div>
    <div class="row wrap gap"><button class="btn small" id="budgetWish"></button><button class="btn small ghost" id="budgetCopy">${t("budgetCopy")}</button></div>
    <div class="small muted">${t("budgetNote")}</div>`;
  res.querySelectorAll(".upcard").forEach(el => el.onclick = () => { const u = r.swaps[el.dataset.i]; openSheet(el.dataset.card === "out" ? u.out : u.in); });
  $("#budgetWish").textContent = t("wishAddShop");
  bindWishButton($("#budgetWish"), () => r.swaps.map(u => ({ card: u.in, count: u.count })), state.currentDeckName || "");
  $("#budgetCopy").onclick = async () => { await copyText(r.swaps.map(u => `${u.count} ${u.in.name}`).join("\n")); $("#budgetCopy").textContent = t("copied"); };
}

export function initBudget() {
  $("#budgetBtn").onclick = openForm;
}
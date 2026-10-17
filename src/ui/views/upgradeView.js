// « Améliorer avec ma collection » (onglet Construire) : échanges proposés, cochés par défaut, appliqués après validation.
import * as deckService from "../../services/deckService.js";
import { $, $$, cImgS, cName, esc, msg, spin } from "../dom.js";
import { openSheet } from "../sheet.js";
import { state, t } from "../state.js";
import { upgradeDeck } from "./buildView.js";

let list = [];

/** Nouveau deck affiché : on efface les anciennes propositions. */
export function resetUpgrade() {
  list = [];
  $("#upgradeBox").innerHTML = "";
}

async function propose() {
  const box = $("#upgradeBox");
  box.innerHTML = `<div class="msg">${spin(t("upLooking"))}</div>`;
  list = await deckService.upgrade(state.deck, { deckId: state.currentDeckId, useReserved: $("#useRes").checked, useEdhrec: $("#useEdh").checked });
  if (!list.length) { box.innerHTML = `<div class="msg ok">${t("upNone")}</div>`; return; }
  const thumb = c => (cImgS(c) ? `<img src="${esc(cImgS(c))}" alt="">` : "");
  box.innerHTML = `<div class="upbox"><div class="small muted">${t("upHelp")}</div>
    ${list.map((u, i) => `<label class="uprow"><input type="checkbox" data-i="${i}" checked>
      <span class="upcard out" data-card="out" data-i="${i}">${thumb(u.out)}<span>− ${u.count > 1 ? `${u.count} ` : ""}${esc(cName(u.out))}</span></span>
      <span class="uparrow">→</span>
      <span class="upcard in" data-card="in" data-i="${i}">${thumb(u.in)}<span>+ ${esc(cName(u.in))}</span></span>
      <small class="upgain">+${Math.round(u.gain * 100)}</small>
      ${u.side ? `<small class="upside muted">${t("upFromSide")(u.side, esc(cName(u.out)))}</small>` : ""}</label>`).join("")}
    <div class="row wrap gap"><button class="btn small" id="upApply"></button><button class="btn small ghost" id="upCancel">${t("propSkip")}</button></div>
    <div class="msg" id="upMsg"></div></div>`;
  const count = () => $$("#upgradeBox input[type=checkbox]").filter(x => x.checked).length;
  const label = () => { $("#upApply").textContent = t("upApply")(count()); $("#upApply").disabled = !count(); };
  $$("#upgradeBox input[type=checkbox]").forEach(x => { x.onchange = label; });
  label();
  // appui sur une image = fiche de la carte (sans cocher / décocher)
  $$("#upgradeBox .upcard img").forEach(img => img.onclick = e => {
    e.preventDefault();
    const el = img.closest(".upcard"), u = list[el.dataset.i];
    openSheet(el.dataset.card === "out" ? u.out : u.in);
  });
  $("#upCancel").onclick = resetUpgrade;
  $("#upApply").onclick = async () => {
    const chosen = $$("#upgradeBox input[type=checkbox]").filter(x => x.checked).map(x => list[x.dataset.i]);
    const { lines, ok } = await upgradeDeck(chosen);
    resetUpgrade();
    msg($("#editMsg"), `${t("upDone")} ${esc(lines.join(" · "))}`, ok ? "ok" : "err");
  };
}

export function initUpgrade() {
  $("#upgradeBtn").onclick = propose;
}

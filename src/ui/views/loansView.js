// Cartes prêtées : rubrique « 🤝 Prêter » de la fiche d'une carte, et liste « qui a quoi » (bouton 🤝 de la collection).
import * as core from "../../core/index.js";
import * as loanService from "../../services/loanService.js";
import { $, $$, cNameOf, esc, msg } from "../dom.js";
import { state, t } from "../state.js";

let onChanged = async () => {};
const date = d => (d ? new Date(d).toLocaleDateString(state.lang, { day: "numeric", month: "short" }) : "");

/** Après un prêt ou un retour : la collection (exemplaires libres) et le bouton 🤝 sont redessinés. */
async function changed() {
  await onChanged();
  await updateLoansButton();
}

/** Rubrique « Prêter » d'une carte possédée, dans sa fiche. */
export async function renderCardLoans(el, card) {
  const all = await loanService.loans(), mine = all.filter(l => l.name === card.name);
  const lent = mine.reduce((a, l) => a + l.count, 0), free = Math.max(0, card.free ?? card.quantity);
  el.innerHTML = `<details class="loanbox" ${mine.length ? "open" : ""}><summary>${t("loanTitle")}${lent ? ` · ${t("loanLent")(lent)}` : ""}</summary>
    ${mine.map(l => `<div class="loanrow"><span>${l.count}× → <b>${esc(l.to)}</b> <small class="muted">${t("loanSince")(date(l.date))}</small></span>
      <button class="btn small ghost" data-back="${esc(l.id)}">${t("loanBack")}</button></div>`).join("")}
    ${free > 0 ? `<div class="loanform"><input type="number" id="loanN" min="1" max="${free}" value="1" aria-label="${esc(t("loanCount"))}">
      <input type="text" id="loanTo" list="loanPeople" autocomplete="off" placeholder="${esc(t("loanToPh"))}">
      <datalist id="loanPeople">${core.borrowers(all).map(p => `<option value="${esc(p)}">`).join("")}</datalist>
      <button class="btn small" id="loanGo">${t("loanGo")}</button></div>` : `<div class="muted small">${t("loanNoFree")}</div>`}
    <div class="msg" id="loanMsg"></div></details>`;
  const again = async () => renderCardLoans(el, state.collection.find(c => c.name === card.name) || card);
  el.querySelectorAll("[data-back]").forEach(b => b.onclick = async () => { await loanService.giveBack(b.dataset.back); await changed(); again(); });
  if ($("#loanGo")) $("#loanGo").onclick = async () => {
    const to = $("#loanTo").value.trim(), n = Math.min(free, Math.max(1, parseInt($("#loanN").value, 10) || 1));
    if (!to) { msg($("#loanMsg"), t("loanNoName"), "err"); $("#loanTo").focus(); return; }
    await loanService.lend(card.name, n, to);
    await changed();
    await again();
    msg($("#loanMsg"), t("loanDone")(n, esc(to)), "ok");
  };
}

/** Bouton « 🤝 Prêts (n) » de la collection : visible seulement s'il y a des cartes prêtées. */
export async function updateLoansButton() {
  const n = (await loanService.loans()).reduce((a, l) => a + l.count, 0);
  $("#loansBtn").hidden = !n;
  $("#loansBtn").textContent = t("loansBtn")(n);
}

/** Qui a quoi : prêts regroupés par personne, avec « rendue » carte par carte ou tout d'un coup. */
export async function openLoans() {
  const groups = core.loansByPerson(await loanService.loans());
  $("#sheetContent").innerHTML = `<h3>${t("loansTitle")}</h3>
    ${groups.length ? groups.map(g => `<div class="loangroup"><div class="row between"><b>${esc(g.to)} <small class="muted">· ${t("loanLent")(g.count)}</small></b>
        <button class="btn small ghost" data-all="${esc(g.to)}">${t("loanAllBack")}</button></div>
      ${g.loans.map(l => `<div class="loanrow"><span>${l.count}× ${esc(cNameOf(l.name))} <small class="muted">${t("loanSince")(date(l.date))}</small></span>
        <button class="btn small ghost" data-back="${esc(l.id)}">${t("loanBack")}</button></div>`).join("")}</div>`).join("")
      : `<p class="muted">${t("loansNone")}</p>`}
    <p class="muted small">${t("loansHelp")}</p>`;
  $$("#sheetContent [data-back]").forEach(b => b.onclick = async () => { await loanService.giveBack(b.dataset.back); await changed(); openLoans(); });
  $$("#sheetContent [data-all]").forEach(b => b.onclick = async () => { await loanService.giveBackAll(b.dataset.all); await changed(); openLoans(); });
  $("#sheet").hidden = false;
}

export function initLoans({ onCollectionChanged }) {
  onChanged = onCollectionChanged;
  $("#loansBtn").onclick = openLoans;
}

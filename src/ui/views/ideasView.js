// « Que puis-je construire ? » (onglet Construire) : les meilleurs decks Commander possibles avec ma collection,
// en tenant compte du souhait tapé (« zombies »…). Aucun appel réseau, aucune IA : le moteur essaie chaque commandant.
import * as deckService from "../../services/deckService.js";
import { $, $$, cImgS, cName, esc, identityPips, spin } from "../dom.js";
import { t } from "../state.js";

async function show() {
  const box = $("#ideas"), wish = $("#wish").value.trim(), format = $("#fmt").value, cmd = format === "commander";
  box.innerHTML = `<div class="msg">${spin(t("ideasLooking"))}</div>`;
  // laisse le navigateur afficher le message avant le calcul (quelques centaines de ms sur une grosse collection)
  await new Promise(r => setTimeout(r, 30));
  const list = await deckService.ideas({ format, wish, useReserved: $("#useRes").checked });
  if (!list.length) { box.innerHTML = `<div class="msg err">${t(cmd ? "ideasNone" : "ideasNoneSixty")}</div>`; return; }
  const fmtName = t("fmt")[format][0];
  // Commander : un commandant par idée ; 60 cartes : une couleur ou une paire de couleurs (« Rouge / Vert »)
  const title = d => (cmd ? cName(d.commander) : d.colors.map(c => t("colorNames")[c]).join(" / "));
  const img = d => (cmd ? d.commander : d.star);
  box.innerHTML = `<div class="ideas"><div class="small muted">${wish ? t("ideasFor")(fmtName, esc(wish)) : t(cmd ? "ideasHelp" : "ideasHelpSixty")(fmtName)}</div>
    ${list.map((d, i) => `<button class="idea" data-i="${i}">
      ${img(d) && cImgS(img(d)) ? `<img src="${esc(cImgS(img(d)))}" alt="">` : '<span class="noimg"></span>'}
      <span class="ib"><b>${esc(title(d))}</b>
        <small>${identityPips(d.identity)} · ${t("stScore")} ${Math.round((d.power ?? 0) * 100)}/100 · ${d.missing ? `<span class="res">${t(cmd ? "ideasMissing" : "ideasMissingSpells")(d.missing)}</span>` : `<span class="free">${t("ideasComplete")}</span>`}
          ${d.fit != null ? ` · ★ ${Math.round(d.fit * 100)} %` : ""}</small>
        ${d.themes?.length ? `<small class="muted">${esc(d.themes.join(", "))}</small>` : ""}</span>
      <span class="igo">${t("ideasBuild")}</span></button>`).join("")}</div>`;
  $$("#ideas .idea").forEach(b => b.onclick = () => {
    const d = list[b.dataset.i];
    // construit ce deck avec les réglages actuels (souhait, emprunts, EDHREC…)
    if (cmd) { $("#cmd").value = d.commander.name; $("#cmd").onchange?.(); } // propose aussi son partenaire s'il en a un
    else $$("#colors input").forEach(i => { i.checked = d.colors.includes(i.value); });
    $("#ideas").innerHTML = "";
    $("#go").click();
  });
}

export function initIdeas() {
  $("#ideasBtn").onclick = show;
}

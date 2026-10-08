// Onglet « Mes decks » : decks enregistrés, ouverture pour modification, éclatement.
import * as decksRepo from "../../data/decksRepo.js";
import { $, $$, cImg, cNameOf, esc, identityPips } from "../dom.js";
import { state, t } from "../state.js";
import { armBreak, setDeck } from "./buildView.js";

let showTab = () => {};

export async function render() {
  const list = await decksRepo.listDecks();
  const el = $("#deckList");
  if (!list.length) { el.innerHTML = `<div class="card empty">${t("noDecks")}</div>`; return; }
  const items = await Promise.all(list.map(async d => ({ ...d, borrowed: await decksRepo.borrowReport(d.deck, state.collection, d.id) })));
  el.innerHTML = items.map((d, i) => {
    const dk = d.deck, c = dk.commander, img = c ? cImg(c) : null;
    return `<div class="dk">${img ? `<img src="${img}" alt="">` : ""}<div class="dkb">
      <h3>${esc(d.name)}</h3>
      <div class="meta">${identityPips(dk.identity)} · ${dk.format} · ${dk.total + (c ? 1 : 0)} ${t("stCards")} · ${dk.value_eur} €${dk.to_buy?.length ? ` · 🛒 ${dk.buy_cost} €` : ""} · ${d.saved_at}</div>
      ${d.borrowed.length ? `<div class="borrowed">${t("shares")} ${d.borrowed.map(b => `${b.count}× ${esc(cNameOf(b.name))}`).join(", ")}</div>` : ""}
      <button class="btn small full" data-open="${i}">${t("open")}</button>
      <button class="btn small danger full" data-break="${d.id}">${t("breakDeck")(esc(d.name))}</button></div></div>`;
  }).join("");
  $$("#deckList [data-open]").forEach(b => b.onclick = () => {
    const d = items[b.dataset.open];
    state.lastBody = { format: d.deck.format, commander: d.deck.commander?.name || "", colors: d.deck.identity, use_reserved: false };
    showTab("build");
    setDeck(d.deck, { id: d.id, name: d.name });
  });
  $$("#deckList [data-break]").forEach(b => armBreak(b, render));
}

export function init({ onShowTab }) { showTab = onShowTab; }

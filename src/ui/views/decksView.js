// Onglet « Mes decks » : decks enregistrés, ouverture pour modification, éclatement, avis de rotation / cartes bannies.
import { commandZone } from "../../core/index.js";
import * as decksRepo from "../../data/decksRepo.js";
import * as formatService from "../../services/formatService.js";
import * as gameHistoryService from "../../services/gameHistoryService.js";
import { $, $$, cImg, cNameOf, esc, identityPips, msg, spin } from "../dom.js";
import { state, t } from "../state.js";
import { armBreak, setDeck } from "./buildView.js";

let showTab = () => {};

export async function render() {
  renderNotices();
  // une fois par jour, en arrière-plan : formats à jour (rotation, cartes bannies) ; un deck rangé ailleurs → on redessine
  formatService.checkDeckFormats().then(fresh => { if (fresh?.length) render(); }).catch(() => { /* hors ligne : demain */ });
  const list = await decksRepo.listDecks();
  const el = $("#deckList");
  if (!list.length) { el.innerHTML = `<div class="card empty">${t("noDecks")}</div>`; return; }
  const records = await gameHistoryService.deckRecords();
  const items = await Promise.all(list.map(async d => ({ ...d, borrowed: await decksRepo.borrowReport(d.deck, state.collection, d.id) })));
  el.innerHTML = items.map((d, i) => {
    const dk = d.deck, c = dk.commander, img = c ? cImg(c) : null, rec = records.get(d.id);
    return `<div class="dk">${img ? `<img src="${img}" alt="">` : ""}<div class="dkb">
      <h3>${esc(d.name)}</h3>
      <div class="meta">${identityPips(dk.identity)} · ${dk.format} · ${dk.total + commandZone(dk).length} ${t("stCards")} · ${dk.value_eur} €${dk.to_buy?.length ? ` · 🛒 ${dk.buy_cost} €` : ""} · ${d.saved_at}${rec ? ` · <span title="${esc(t("gameDeckRecord"))}">🏆 ${rec.wins}/${rec.played}</span>` : ""}</div>
      ${d.borrowed.length ? `<div class="borrowed">${t("shares")} ${d.borrowed.map(b => `${b.count}× ${esc(cNameOf(b.name))}`).join(", ")}</div>` : ""}
      <button class="btn small full" data-open="${i}">${t("open")}</button>
      <button class="btn small danger full" data-break="${d.id}">${t("breakDeck")(esc(d.name))}</button></div></div>`;
  }).join("");
  $$("#deckList [data-open]").forEach(b => b.onclick = () => openSavedDeck(items[b.dataset.open]));
  $$("#deckList [data-break]").forEach(b => armBreak(b, render));
}

const fmtName = f => t("fmt")[f]?.[0] || f;

/** Avis de formats : deck rangé dans un autre format (rotation), ou cartes bannies à remplacer. */
async function renderNotices() {
  const list = await formatService.formatNotices(), el = $("#deckNotices");
  const cards = n => n.cards.slice(0, 6).map(c => esc(cNameOf(c))).join(", ") + (n.cards.length > 6 ? "…" : "");
  el.innerHTML = list.map(n => `<div class="card fmtnotice"><button class="qb" data-dismiss="${esc(n.key)}" aria-label="${esc(t("close"))}">✕</button>
      ${n.to ? t("fmtMoved")(esc(n.deck), fmtName(n.from), fmtName(n.to), cards(n), n.cards.length)
        : t("fmtIllegal")(esc(n.deck), fmtName(n.from), cards(n), n.cards.length, n.banned)}</div>`).join("")
    + `<div class="row end"><button class="btn small ghost" id="fmtCheck">${t("fmtCheck")}</button></div><div class="msg" id="fmtMsg"></div>`;
  $$("#deckNotices [data-dismiss]").forEach(b => b.onclick = async () => { await formatService.dismissNotice(b.dataset.dismiss); renderNotices(); });
  $("#fmtCheck").onclick = async () => {
    msg($("#fmtMsg"), spin(t("fmtChecking")));
    try {
      const fresh = await formatService.checkDeckFormats({ force: true });
      await render();
      msg($("#fmtMsg"), fresh?.length ? "" : t("fmtAllGood"), "ok");
    } catch (e) { msg($("#fmtMsg"), `${t("netErr")}${esc(e.message)}`, "err"); }
  };
}

/** Ouvre un deck enregistré dans l'onglet « Construire » (pour le modifier, l'analyser avec l'IA…). */
export function openSavedDeck(d) {
  state.lastBody = { format: d.deck.format, commander: d.deck.commander?.name || "", partner: d.deck.partner?.name || "", colors: d.deck.identity, use_reserved: false };
  showTab("build");
  setDeck(d.deck, { id: d.id, name: d.name });
}

export function init({ onShowTab }) { showTab = onShowTab; }

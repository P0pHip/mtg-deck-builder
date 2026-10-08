// Onglet « Collection » : liste filtrable, +/−, ajout de cartes par recherche Scryfall.
import { category } from "../../core/cards.js";
import { search } from "../../data/scryfall/index.js";
import * as collectionService from "../../services/collectionService.js";
import { $, $$, cImgS, cName, cType, dfc, esc, msg, norm, pips, spin } from "../dom.js";
import { openSheet } from "../sheet.js";
import { onLangChange, state, t } from "../state.js";

const MAX_ROWS = 300; // au-delà, on demande d'affiner le filtre (fluidité sur téléphone)
let rows = [];

export async function refresh() {
  state.collection = await collectionService.loadWithReservations();
  render();
}

function render() {
  const col = state.collection;
  const total = col.reduce((a, c) => a + c.quantity, 0);
  const value = col.reduce((a, c) => a + (c.price_eur || 0) * c.quantity, 0);
  $("#colCount").textContent = col.length ? `${col.length} ${t("cards")} · ${total} ${t("copies")} · ${value.toFixed(0)} €` : "";
  $("#colEmpty").style.display = col.length ? "none" : "";
  $("#colEmpty").textContent = t("emptyCol");

  const q = norm($("#filter").value.trim());
  const sorters = {
    name: (a, b) => cName(a).localeCompare(cName(b)),
    cmc: (a, b) => a.cmc - b.cmc || cName(a).localeCompare(cName(b)),
    price: (a, b) => (b.price_eur || 0) - (a.price_eur || 0),
    rank: (a, b) => (a.edhrec_rank || 1e9) - (b.edhrec_rank || 1e9),
    qty: (a, b) => b.quantity - a.quantity,
  };
  rows = col.filter(c => !q || [c.name, c.type_line, c.oracle_text, c.fr?.name, c.fr?.text, c.fr?.type_line].some(x => norm(x).includes(q)))
    .sort(sorters[$("#sortBy").value] || sorters.name);

  $("#colList").innerHTML = rows.slice(0, MAX_ROWS).map((c, i) => `<div class="crow" data-i="${i}">
      ${cImgS(c) ? `<img loading="lazy" src="${cImgS(c)}" alt="">` : '<div class="noimg"></div>'}
      <div class="ci"><b>${esc(cName(c))}${dfc(c)}</b><small>${pips(c.mana_cost)} ${esc(cType(c))}</small>
        <small>${c.price_eur != null ? c.price_eur + " € · " : ""}${t("cat")[category(c)]}${c.reserved?.length ? ` · <span class="res">${c.reserved.map(r => `${r.count}× ${esc(r.name)}`).join(", ")}</span>` : ""}</small></div>
      <div class="qty"><button class="qb" data-d="-1" aria-label="−">−</button><b style="color:${c.free > 0 ? "var(--txt)" : "var(--red)"}">${c.quantity}</b><button class="qb" data-d="1" aria-label="+">+</button></div>
    </div>`).join("") + (rows.length > MAX_ROWS ? `<div class="empty">${t("refine300")(rows.length)}</div>` : "");

  $$("#colList .crow").forEach(row => {
    const c = rows[row.dataset.i];
    row.querySelector(".ci").onclick = () => openSheet(c);
    row.querySelector("img, .noimg").onclick = () => openSheet(c);
    row.querySelectorAll(".qb").forEach(b => b.onclick = () => changeQty(c, +b.dataset.d));
  });
}

async function changeQty(c, delta) {
  const r = await collectionService.changeQuantity(c, delta);
  msg($("#colMsg"), r.overflow ? "⚠ " + t("qtyWarn")(cName(c), r.reserved, r.quantity) : "", r.overflow ? "err" : "");
  if (r.quantity <= 0) state.collection = state.collection.filter(x => x !== c);
  else { c.quantity = r.quantity; c.free = r.quantity - r.reserved; }
  render();
}

// ------------------------------------------------------------ recherche / ajout
let timer = null, seq = 0;
async function runSearch(q) {
  const my = ++seq;
  msg($("#addMsg"), spin(t("searching")));
  let results;
  try { results = await search(q, state.lang); } catch (e) { msg($("#addMsg"), t("netErr") + e.message, "err"); return; }
  if (my !== seq) return; // une recherche plus récente est partie
  const owned = Object.fromEntries(state.collection.map(c => [c.name, c.quantity]));
  const label = r => (state.lang === "fr" && r.printed_name ? r.printed_name : r.name);
  msg($("#addMsg"), results.length ? "" : t("noResult"));
  $("#addResults").innerHTML = results.map((r, i) => `<div class="res-card">${r.image_small ? `<img src="${r.image_small}" alt="">` : ""}
    <div class="ci"><b>${esc(label(r))}</b><small>${esc(r.type_line)}</small>
      <small>${esc(r.set_name || "")}${owned[r.name] ? ` · <span class="free">${t("owned")(owned[r.name])}</span>` : ""}</small></div>
    <input type="number" min="1" value="1" inputmode="numeric" id="aq${i}" aria-label="qty"><button class="btn small" data-add="${i}">${t("add")}</button></div>`).join("");
  $$("#addResults .res-card img").forEach((img, i) => { img.onclick = () => openSheet({ ...results[i], oracle_text: "" }); });
  $$("#addResults [data-add]").forEach(b => b.onclick = async () => {
    const r = results[b.dataset.add], qty = Math.max(1, +$("#aq" + b.dataset.add).value || 1);
    b.disabled = true;
    try {
      const total = await collectionService.addCard(r.name, qty, r.set);
      msg($("#addMsg"), t("added")(label(r), total), "ok");
      await refresh();
    } catch (e) {
      msg($("#addMsg"), t("netErr") + (e.message === "not-found" ? t("notFoundCard") : e.message), "err");
    }
    b.disabled = false;
  });
}

export function init() {
  $("#filter").oninput = render;
  $("#sortBy").onchange = render;
  $("#addSearch").oninput = () => {
    clearTimeout(timer);
    const q = $("#addSearch").value.trim();
    if (q.length < 2) { $("#addResults").innerHTML = ""; msg($("#addMsg"), ""); return; }
    timer = setTimeout(() => runSearch(q), 450);
  };
  onLangChange(() => {
    $("#filter").placeholder = t("filter");
    $("#addSearch").placeholder = t("addPh");
    render();
  });
}

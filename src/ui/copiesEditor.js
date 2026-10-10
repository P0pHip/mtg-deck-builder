// Éditeur des exemplaires d'une carte possédée (dans sa fiche) : extension, numéro, langue, foil, état, quantité.
// Chaque changement est enregistré tout de suite ; la collection affichée est prévenue par l'évènement « collection-changed ».
import * as core from "../core/index.js";
import { prints } from "../data/scryfall/index.js";
import * as collectionService from "../services/collectionService.js";
import { $, esc, msg } from "./dom.js";
import { state, t } from "./state.js";

/** Langue en toutes lettres (« Français ») ; « — » = non précisée. */
const langLabel = l => (l ? t("langNames")[l] || l.toUpperCase() : t("langUnknown"));
const langOptions = cur => ["", ...core.LANGS].map(l => `<option value="${l}" ${l === cur ? "selected" : ""} title="${esc(l.toUpperCase())}">${esc(langLabel(l))}</option>`).join("");
/** État en toutes lettres (« Comme neuve ») ; le code des sites d'achat (NM, LP…) en infobulle. */
const condTip = c => `${c} — ${t("condCodes")[c]}`;
const condOptions = cur => core.CONDITIONS.map(c => `<option value="${c}" ${c === cur ? "selected" : ""} title="${esc(condTip(c))}">${esc(t("condNames")[c])}</option>`).join("");

/** Rend l'éditeur dans `el` pour la carte possédée `card`. */
export function renderCopies(el, card) {
  const list = core.copiesOf(card);
  el.innerHTML = `<h4 class="cphead">${t("cpTitle")(card.quantity)}</h4>
    <div class="cplist">${list.map((cp, i) => `<div class="cprow" data-i="${i}">
      <span class="cpset" title="${esc(cp.set_name || cp.set.toUpperCase())}">${esc(cp.set.toUpperCase() || "?")}${cp.number ? `<small> n°${esc(cp.number)}</small>` : ""}</span>
      <select class="small cplang" aria-label="${esc(t("cpLang"))}" title="${esc(t("cpLang"))}">${langOptions(cp.lang)}</select>
      <button class="cpfoil ${cp.foil ? "on" : ""}" title="${esc(t("cpFoil"))}" aria-pressed="${cp.foil}">✨</button>
      <select class="small cpcond" aria-label="${esc(t("cpCond"))}" title="${esc(`${t("cpCond")} : ${condTip(cp.condition)}`)}">${condOptions(cp.condition)}</select>
      <span class="cpprice">${core.copyPrice(card, cp) ? core.copyPrice(card, cp).toFixed(2) + " €" : ""}</span>
      <span class="qty"><button class="qb" data-d="-1" aria-label="−">−</button><b>${cp.qty}</b><button class="qb" data-d="1" aria-label="+">+</button></span>
    </div>`).join("")}</div>
    <button class="btn small ghost" id="cpAddBtn">${t("cpAdd")}</button>
    <div class="cpform" id="cpForm" hidden></div>
    <div class="msg" id="cpMsg"></div>`;

  const save = async (cp, changes) => {
    const updated = await collectionService.updateCopy(card.name, core.copyKey(cp), changes);
    after(el, updated || { ...card, quantity: 0, copies: [] });
  };
  el.querySelectorAll(".cprow").forEach(row => {
    const cp = list[row.dataset.i];
    row.querySelector(".cplang").onchange = e => save(cp, { lang: e.target.value });
    row.querySelector(".cpcond").onchange = e => save(cp, { condition: e.target.value });
    row.querySelector(".cpfoil").onclick = () => save(cp, { foil: !cp.foil });
    row.querySelectorAll(".qb").forEach(b => b.onclick = () => save(cp, { qty: cp.qty + +b.dataset.d }));
  });
  $("#cpAddBtn").onclick = () => openForm(el, card);
}

/** Formulaire « ajouter un exemplaire » : impression (liste Scryfall), langue, foil, état, quantité. */
async function openForm(el, card) {
  const form = $("#cpForm");
  form.hidden = false;
  form.innerHTML = `<div class="msg">${t("loadingPrints")}</div>`;
  let list = [];
  try { list = await prints(card.name); } catch { /* garde l'extension de la carte */ }
  if (!list.length) list = [{ set: card.set, set_name: card.set_name, number: "", price_eur: card.price_eur }];
  form.innerHTML = `<select class="small" id="cpSet">${list.map((p, i) => `<option value="${i}">${esc(p.set_name)} (${esc(p.set.toUpperCase())})</option>`).join("")}</select>
    <div class="row wrap"><select class="small" id="cpLang" aria-label="${esc(t("cpLang"))}" title="${esc(t("cpLang"))}">${langOptions(state.lang === "fr" ? "fr" : "")}</select>
      <label class="chk small"><input type="checkbox" id="cpNewFoil"> ✨ ${t("cpFoil")}</label>
      <select class="small" id="cpNewCond" aria-label="${esc(t("cpCond"))}">${condOptions("NM")}</select>
      <input type="number" id="cpQty" min="1" value="1" inputmode="numeric" aria-label="qty">
      <button class="btn small" id="cpOk">${t("add")}</button></div>`;
  $("#cpOk").onclick = async () => {
    const p = list[+$("#cpSet").value];
    await collectionService.addCopy(card, {
      set: p.set, set_name: p.set_name, number: p.number || "", lang: $("#cpLang").value, foil: $("#cpNewFoil").checked,
      condition: $("#cpNewCond").value, qty: Math.max(1, +$("#cpQty").value || 1), price_eur: p.price_eur ?? null, price_foil: p.price_foil ?? null,
    });
    after(el, await collectionService.getCard(card.name));
    msg($("#cpMsg"), t("cpAdded"), "ok");
  };
}

/** Après un changement : la collection affichée est mise à jour, l'éditeur redessiné. */
function after(el, card) {
  const i = state.collection.findIndex(c => c.name === card.name);
  if (card.quantity > 0) {
    if (i >= 0) state.collection[i] = { ...state.collection[i], copies: card.copies, quantity: card.quantity };
    renderCopies(el, card);
  } else {
    if (i >= 0) state.collection.splice(i, 1);
    el.innerHTML = `<div class="msg ok">${t("cpRemoved")}</div>`;
  }
  document.dispatchEvent(new Event("collection-changed"));
}

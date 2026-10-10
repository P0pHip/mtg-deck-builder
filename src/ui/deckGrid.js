// Grille des cartes d'un deck (decks préconstruits, decklist importée) : image, nombre, état dans la collection.
import { category } from "../core/cards.js";
import { cImgS, cName, esc } from "./dom.js";
import { openSheet } from "./sheet.js";
import { t } from "./state.js";

const BOARD_ORDER = { commander: 0, main: 1, side: 2 };
const CAT_ORDER = ["creature", "ramp", "draw", "removal", "wipe", "other", "land"];

/** Tri d'affichage : commandant, deck, réserve ; puis par rôle, coût et nom. */
export const sortDeckCards = cards => [...cards].sort((a, b) => BOARD_ORDER[a.board] - BOARD_ORDER[b.board]
  || CAT_ORDER.indexOf(category(a.card)) - CAT_ORDER.indexOf(category(b.card)) || a.card.cmc - b.card.cmc || cName(a.card).localeCompare(cName(b.card)));

/**
 * HTML de la grille. `status(x)` → { have: bool, cls: classe du texte, label: texte sous le nom }.
 * Les cartes doivent être déjà triées (voir sortDeckCards) : l'index sert à ouvrir la fiche.
 */
export function deckGridHtml(cards, status) {
  return cards.map((x, i) => {
    const s = status(x);
    return `<div class="stile ${s.have ? "have" : ""}" data-i="${i}">
      <div class="simg">${cImgS(x.card) ? `<img loading="lazy" src="${esc(cImgS(x.card))}" alt="${esc(cName(x.card))}">` : `<div class="noimg">${esc(cName(x.card))}</div>`}
        <span class="cnt">×${x.count}</span>${x.board !== "main" ? `<span class="rar S" title="${esc(t("preconBoards")[x.board])}">${x.board === "commander" ? "★" : "R"}</span>` : ""}</div>
      <div class="sname" title="${esc(cName(x.card))}">${esc(cName(x.card))}</div>
      <small class="${s.cls}">${s.label}</small></div>`;
  }).join("");
}

/** Appui sur une image = fiche de la carte. */
export function bindDeckGrid(root, cards) {
  root.querySelectorAll(".stile").forEach(el => { el.querySelector(".simg").onclick = () => openSheet(cards[el.dataset.i].card); });
}

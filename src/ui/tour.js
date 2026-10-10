// Tutoriel : visite guidée de l'appli, étape par étape, en éclairant l'élément concerné.
// Lancé automatiquement à la première visite, puis à la demande (bouton « ? » en haut, ou onglet « Plus »).
import { $, esc } from "./dom.js";
import { onLangChange, t } from "./state.js";

const DONE = "tourDone";
// tab : onglet à afficher ; el : élément à éclairer (aucun = message centré) ; open : ouvrir le bloc « Ajouter des cartes »
const STEPS = [
  { id: "welcome" },
  { id: "add", tab: "collection", el: "#addSearch", open: true },
  { id: "scan", tab: "collection", el: "#scanBtn", open: true },
  { id: "browse", tab: "collection", el: "#browseSet", open: true },
  { id: "precon", tab: "collection", el: "#preconBtn", open: true },
  { id: "folders", tab: "collection", el: ".viewbar" },
  { id: "import", tab: "more", el: "#file", card: true },
  { id: "format", tab: "build", el: "#fmt" },
  { id: "wish", tab: "build", el: "#wish" },
  { id: "generate", tab: "build", el: "#go" },
  { id: "decks", tab: "decks", el: "#decks .card" },
  { id: "ai", tab: "more", el: "#aiBox", card: true },
  { id: "backup", tab: "more", el: "#exportBtn", card: true },
  { id: "end" },
];

let i = 0, showTab = () => {}, root = null;

const seen = () => { try { return !!localStorage.getItem(DONE); } catch { return true; } };
const markSeen = () => { try { localStorage.setItem(DONE, "1"); } catch { /* sans stockage */ } };

export function initTour({ onShowTab }) {
  showTab = onShowTab;
  root = document.createElement("div");
  root.className = "tour";
  root.hidden = true;
  root.innerHTML = `<div class="tour-hole" id="tourHole"></div>
    <div class="tour-pop" id="tourPop" role="dialog" aria-modal="true" aria-labelledby="tourTitle">
      <div class="tour-dots" id="tourDots"></div>
      <h3 id="tourTitle"></h3><p id="tourText"></p>
      <div class="row between"><button class="btn small ghost" id="tourSkip"></button>
        <div class="row"><button class="btn small ghost" id="tourPrev"></button><button class="btn small" id="tourNext"></button></div></div>
    </div>`;
  document.body.appendChild(root);
  $("#tourSkip").onclick = stop;
  $("#tourPrev").onclick = () => go(i - 1);
  $("#tourNext").onclick = () => (i >= STEPS.length - 1 ? stop() : go(i + 1));
  document.addEventListener("keydown", e => {
    if (root.hidden) return;
    if (e.key === "Escape") stop();
    else if (e.key === "ArrowRight") $("#tourNext").click();
    else if (e.key === "ArrowLeft" && i > 0) go(i - 1);
  });
  addEventListener("resize", () => { if (!root.hidden) place(); });
  onLangChange(() => { if (!root.hidden) go(i); });
}

/** Lance la visite ; `onlyFirstTime` : seulement si elle n'a jamais été vue. */
export function startTour({ onlyFirstTime = false } = {}) {
  if (onlyFirstTime && seen()) return;
  root.hidden = false;
  document.body.classList.add("noscroll");
  go(0);
}

function stop() {
  root.hidden = true;
  document.body.classList.remove("noscroll");
  markSeen();
  showTab("collection");
}

function target() {
  const s = STEPS[i];
  if (!s.el) return null;
  const el = document.querySelector(s.el);
  return el && s.card ? el.closest(".card") || el : el;
}

function go(n) {
  i = Math.max(0, Math.min(STEPS.length - 1, n));
  const s = STEPS[i];
  if (s.tab && !$(`#${s.tab}`).classList.contains("on")) showTab(s.tab);
  if (s.open) $("#addBox").open = true;
  const [title, text] = t("tour")[s.id];
  $("#tourTitle").textContent = title;
  $("#tourText").innerHTML = esc(text).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  $("#tourDots").innerHTML = STEPS.map((_, k) => `<i class="${k === i ? "on" : ""}"></i>`).join("") + `<span>${i + 1}/${STEPS.length}</span>`;
  $("#tourPrev").textContent = t("tourPrev");
  $("#tourPrev").hidden = i === 0;
  $("#tourNext").textContent = i === STEPS.length - 1 ? t("tourDone") : i === 0 ? t("tourStart") : t("tourNext");
  $("#tourSkip").textContent = t("tourSkip");
  $("#tourSkip").hidden = i === STEPS.length - 1;
  const el = target();
  // la page est bloquée pendant la visite : on fait défiler jusqu'à l'élément, puis on le cadre
  if (el) {
    document.body.classList.remove("noscroll");
    el.scrollIntoView({ block: "center", behavior: "instant" });
    document.body.classList.add("noscroll");
  }
  place();
  requestAnimationFrame(place); // après le changement d'onglet / l'ouverture du bloc
  $("#tourNext").focus({ preventScroll: true });
}

/** Cadre l'élément et place la bulle au-dessus ou en dessous, sans sortir de l'écran. */
function place() {
  const hole = $("#tourHole"), pop = $("#tourPop"), el = target();
  const vw = innerWidth, vh = innerHeight, m = 12;
  pop.style.width = `${Math.min(380, vw - 32)}px`;
  if (!el || !el.getClientRects().length) {
    hole.className = "tour-hole none";
    pop.style.left = `${(vw - pop.offsetWidth) / 2}px`;
    pop.style.top = `${Math.max(m, (vh - pop.offsetHeight) / 2)}px`;
    return;
  }
  const r = el.getBoundingClientRect(), pad = 6;
  hole.className = "tour-hole";
  Object.assign(hole.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + 2 * pad}px`, height: `${r.height + 2 * pad}px` });
  const ph = pop.offsetHeight, below = r.bottom + pad + m, above = r.top - pad - m - ph;
  const top = below + ph < vh - 70 ? below : above > m ? above : Math.max(m, vh - ph - 80);
  pop.style.top = `${top}px`;
  pop.style.left = `${Math.max(16, Math.min(vw - pop.offsetWidth - 16, r.left + r.width / 2 - pop.offsetWidth / 2))}px`;
}

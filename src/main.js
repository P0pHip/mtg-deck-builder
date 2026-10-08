// Point d'entrée de l'appli : branche les vues, la langue, les onglets et le mode hors ligne.
import "./styles/main.css";
import { $, $$ } from "./ui/dom.js";
import { initSheet } from "./ui/sheet.js";
import { onLangChange, setLang, state, t } from "./ui/state.js";
import * as aiView from "./ui/views/aiView.js";
import * as buildView from "./ui/views/buildView.js";
import * as collectionView from "./ui/views/collectionView.js";
import * as decksView from "./ui/views/decksView.js";
import * as moreView from "./ui/views/moreView.js";
import { initSetBrowser } from "./ui/views/setBrowser.js";
import { initScanner } from "./ui/views/scanner.js";

/** Recharge les données partagées (collection + réservations) puis les vues qui en dépendent. */
async function refreshAll() {
  await collectionView.refresh();
  await buildView.loadCommanders();
  if ($("#decks").classList.contains("on")) await decksView.render();
}

function resetDeck() {
  state.deck = null; state.currentDeckId = null; state.currentDeckName = "";
  $("#result").style.display = "none";
}

function showTab(tab) {
  $$("nav.tabs button").forEach(x => x.classList.toggle("on", x.dataset.tab === tab));
  $$("main > section").forEach(x => x.classList.toggle("on", x.id === tab));
  window.scrollTo({ top: 0 });
  if (tab === "collection") collectionView.refresh();
  if (tab === "build") buildView.loadCommanders();
  if (tab === "decks") decksView.render();
  if (tab === "more") aiView.refreshSettings();
}

function applyStaticTexts() {
  document.documentElement.lang = state.lang;
  $$("[data-t]").forEach(el => { const v = t(el.dataset.t); if (typeof v === "string") el.textContent = v; });
  $$(".lang button").forEach(b => b.classList.toggle("on", b.dataset.l === state.lang));
  if ($("#decks").classList.contains("on")) decksView.render();
}

// --- initialisation
initSheet();
initSetBrowser();
initScanner();
collectionView.init();
buildView.init({ onRefreshAll: refreshAll });
decksView.init({ onShowTab: showTab });
moreView.init({ onRefreshAll: refreshAll, onReset: resetDeck });
aiView.init();
onLangChange(applyStaticTexts);

$$("nav.tabs button").forEach(b => { b.onclick = () => showTab(b.dataset.tab); });
$$(".lang button").forEach(b => { b.onclick = () => setLang(b.dataset.l); });

setLang(state.lang);      // applique les textes et dessine les vues
await refreshAll();

// --- hors ligne (service worker) — pas en mode développement
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("./sw.js").catch(() => { /* hors ligne indisponible */ });
}

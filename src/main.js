// Point d'entrée de l'appli : branche les vues, la langue, les onglets et le mode hors ligne.
import "./styles/main.css";
import { decodeDeckShare, shareCodeOf, tradeCodeOf } from "./core/share.js";
import { $, $$, msg } from "./ui/dom.js";
import { initSheet } from "./ui/sheet.js";
import { initTour, startTour } from "./ui/tour.js";
import { onLangChange, setLang, state, t } from "./ui/state.js";
import * as aiView from "./ui/views/aiView.js";
import { renderComboBase } from "./ui/views/comboBaseView.js";
import * as buildView from "./ui/views/buildView.js";
import * as collectionView from "./ui/views/collectionView.js";
import * as decksView from "./ui/views/decksView.js";
import * as gameView from "./ui/views/gameView.js";
import * as moreView from "./ui/views/moreView.js";
import { initSetBrowser } from "./ui/views/setBrowser.js";
import { initScanner } from "./ui/views/scanner.js";
import { initHand } from "./ui/views/handView.js";
import { initUpgrade } from "./ui/views/upgradeView.js";
import { initCombos } from "./ui/views/comboView.js";
import { initBudget } from "./ui/views/budgetView.js";
import { initIdeas } from "./ui/views/ideasView.js";
import { initStats } from "./ui/views/statsView.js";
import { initWishlist, openWishlist, updateWishButton } from "./ui/views/wishlistView.js";
import { initPrecons, openPrecons } from "./ui/views/preconBrowser.js";
import { initDeckImport, openDeckImport } from "./ui/views/deckImport.js";
import { openScanner } from "./ui/views/scanner.js";
import { initLoans, updateLoansButton } from "./ui/views/loansView.js";
import { openTradeOffer } from "./ui/views/tradeView.js";

/** Recharge les données partagées (collection + réservations) puis les vues qui en dépendent. */
async function refreshAll() {
  await collectionView.refresh();
  await updateWishButton(); // la restauration ou l'effacement touchent aussi la liste d'envies
  await updateLoansButton();
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
  if (tab === "game") gameView.render();
  if (tab === "more") { aiView.refreshSettings(); renderComboBase(moreView.renderStorage); moreView.prepareShare(); moreView.renderStorage(); }
}

const importOpts = { onSaved: refreshAll, onOpenDeck: d => decksView.openSavedDeck(d), onShowDecks: () => showTab("decks") };

/**
 * Lien reçu, puis retiré de l'adresse : deck (…#deck=…) ouvert dans l'import de decklist (ce que j'ai, ce qui manque),
 * ou classeur d'échange d'un ami (…#trade=…).
 */
async function openSharedDeck() {
  const trade = tradeCodeOf(location.hash), code = shareCodeOf(location.hash);
  if (!trade && !code) return false;
  history.replaceState(null, "", location.pathname + location.search);
  if (trade) {
    const offer = await decodeDeckShare(trade);
    if (offer) openTradeOffer(offer);
    else { $("#sheetContent").innerHTML = `<p class="msg err">${t("diBadLink")}</p>`; $("#sheet").hidden = false; }
    return true;
  }
  const shared = await decodeDeckShare(code);
  openDeckImport({ ...importOpts, shared });
  if (!shared) msg($("#diMsg"), t("diBadLink"), "err"); // lien coupé ou abîmé
  return true;
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
initPrecons();
initHand();
initUpgrade();
initCombos();
initBudget();
initIdeas();
initStats();
initWishlist();
$("#wishBtn").onclick = openWishlist;
initDeckImport();
initLoans({ onCollectionChanged: refreshAll });
collectionView.init();
initTour({ onShowTab: showTab });
$("#tourBtn").onclick = () => startTour();
$("#tourAgain").onclick = () => startTour();
$("#preconBtn").onclick = () => openPrecons({ onClosed: refreshAll, onShowDecks: () => showTab("decks") });
$("#importDeckBtn").onclick = () => openDeckImport(importOpts);
// deck déjà construit en vrai : scanné carte par carte, puis passé à l'import (commandant, ce qui manque, collection)
$("#scanDeckBtn").onclick = () => openScanner({ deck: { onDone: scanned => openDeckImport({ ...importOpts, scanned }) } });
buildView.init({ onRefreshAll: refreshAll });
decksView.init({ onShowTab: showTab });
moreView.init({ onRefreshAll: refreshAll, onReset: resetDeck });
aiView.init();
gameView.init();
onLangChange(applyStaticTexts);

$$("nav.tabs button").forEach(b => { b.onclick = () => showTab(b.dataset.tab); });
$$(".lang button").forEach(b => { b.onclick = () => setLang(b.dataset.l); });

onLangChange(() => updateWishButton());
setLang(state.lang);      // applique les textes et dessine les vues
await refreshAll();
// deck reçu par lien : on l'ouvre (sans visite guidée par-dessus) ; sinon, première visite : petite visite guidée
if (!(await openSharedDeck())) startTour({ onlyFirstTime: true });
addEventListener("hashchange", openSharedDeck); // lien ouvert alors que l'appli l'était déjà

// --- hors ligne (service worker) — pas en mode développement
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("./sw.js").catch(() => { /* hors ligne indisponible */ });
}

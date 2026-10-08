// État partagé de l'interface (une seule source de vérité pour les vues).
import { I18N } from "./i18n.js";

const stored = (() => { try { return localStorage.getItem("lang"); } catch { return null; } })();

export const state = {
  lang: stored || ((navigator.language || "fr").startsWith("fr") ? "fr" : "en"),
  collection: [],          // cartes possédées (+ reserved, free)
  deck: null,              // deck affiché dans l'onglet Construire
  currentDeckId: null,     // deck enregistré en cours d'édition
  currentDeckName: "",
  lastBody: null,          // derniers paramètres de génération
  lastSuggestion: null,
  groupBy: "role",
  chatHistory: [],
};

export const t = key => I18N[state.lang][key];

const listeners = new Set();
/** Une vue s'abonne aux changements de langue (pour se redessiner). */
export const onLangChange = fn => listeners.add(fn);
export function setLang(lang) {
  state.lang = lang;
  try { localStorage.setItem("lang", lang); } catch { /* stockage indisponible */ }
  listeners.forEach(fn => fn());
}

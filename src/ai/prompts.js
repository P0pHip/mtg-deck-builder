// Construction des prompts et lecture des réponses de l'IA. Pur (testé dans tests/ai/prompts.test.js).
// Gemma 4 E2B est un petit modèle : listes courtes, consignes simples, format de sortie strict.
import { BASICS_FR } from "../core/cards.js";

export const displayName = (card, lang) =>
  lang === "fr" ? card.fr?.name || BASICS_FR[card.name] || card.name : card.name;
const displayText = (card, lang) => (lang === "fr" ? card.fr?.text || card.oracle_text || "" : card.oracle_text || "");

const ROLE_FR = { creature: "créature", ramp: "ramp", draw: "pioche", removal: "removal", wipe: "wipe", other: "autre", land: "terrain" };

function deckSummary(deck, lang) {
  const fr = lang === "fr";
  const lines = deck.cards.map(c => `${c.count}x ${displayName(c, lang)} (${fr ? ROLE_FR[c.category] || c.category : c.category}, ${c.cmc})${c.missing ? (fr ? " [à acheter]" : " [to buy]") : ""}`);
  const head = [
    `Format: ${deck.format}`,
    `${fr ? "Couleurs" : "Colors"}: ${deck.identity.join("") || "C"}`,
    deck.commander ? `${fr ? "Commandant" : "Commander"}: ${displayName(deck.commander, lang)} — ${displayText(deck.commander, lang).slice(0, 220)}` : "",
    `${fr ? "Courbe" : "Curve"}: ${Object.entries(deck.curve).map(([k, v]) => `${k}:${v}`).join(" ")} (${fr ? "moyenne" : "avg"} ${deck.avg_cmc})`,
    `${fr ? "Types (exact)" : "Types (exact)"}: ${Object.entries(deck.types || {}).map(([k, v]) => `${k} ${v}`).join(", ")}`,
  ].filter(Boolean);
  return `${head.join("\n")}\n\n${fr ? "DECK" : "DECK"}:\n${lines.join("\n")}`;
}

const benchList = (cards, lang, n) => cards.slice(0, n).map(c => `- ${displayName(c, lang)} (${c.type_line.split("—")[0].trim()}, ${c.cmc})`).join("\n");

/** Messages pour l'analyse du deck. `bench` = cartes libres non jouées, triées par popularité. */
export function explainMessages(deck, bench, lang = "fr") {
  const fr = lang === "fr";
  const system = fr
    ? "Tu es un joueur expert de Magic: The Gathering. Tu réponds en français, de façon concise, en markdown. Tu cites les cartes uniquement avec les noms exacts des listes fournies."
    : "You are an expert Magic: The Gathering player. Answer in English, concisely, in markdown. Only cite cards using the exact names from the provided lists.";
  const ask = fr
    ? `${deckSummary(deck, lang)}\n\nCARTES DE MA COLLECTION NON UTILISÉES :\n${benchList(bench, lang, 25)}\n\nDonne :\n1. **Plan de jeu** (3 phrases)\n2. **Forces / faiblesses**\n3. **3 échanges** : une carte du deck contre une carte NON UTILISÉE ci-dessus (n'invente aucune carte)\n4. **Mulligan** (1 phrase)`
    : `${deckSummary(deck, lang)}\n\nUNUSED CARDS FROM MY COLLECTION:\n${benchList(bench, lang, 25)}\n\nGive:\n1. **Game plan** (3 sentences)\n2. **Strengths / weaknesses**\n3. **3 swaps**: a deck card for an UNUSED card above (do not invent cards)\n4. **Mulligan** (1 sentence)`;
  return [{ role: "system", content: system }, { role: "user", content: ask }];
}

/** Messages pour le chat : le modèle peut proposer des échanges dans un bloc JSON. */
export function chatMessages(deck, available, history, lang = "fr") {
  const fr = lang === "fr";
  const rules = fr
    ? `Tu aides le joueur à améliorer SON deck, construit uniquement avec SA collection. Réponds en français, brièvement.
Si le joueur demande une modification, propose-la puis termine par un bloc JSON EXACTEMENT de cette forme :
\`\`\`json
{"remove":[{"name":"Nom","count":1}],"add":[{"name":"Nom","count":1}]}
\`\`\`
Règles : n'ajoute QUE des cartes de la liste DISPONIBLES ; autant de retraits que d'ajouts ; en Commander count vaut 1 ; utilise les noms exacts des listes ; pas de JSON si aucune modification. Les chiffres de types et de courbe sont exacts : utilise-les.`
    : `You help the player improve THEIR deck, built only from THEIR collection. Answer in English, briefly.
If the player asks for a change, propose it and end with a JSON block EXACTLY like:
\`\`\`json
{"remove":[{"name":"Name","count":1}],"add":[{"name":"Name","count":1}]}
\`\`\`
Rules: only add cards from the AVAILABLE list; as many removals as additions; in Commander count is 1; use exact names from the lists; no JSON if there is no change. Type and curve numbers are exact: use them.`;
  const inDeck = new Set(deck.cards.map(c => c.name));
  const avail = available.filter(c => !inDeck.has(c.name));
  const system = `${rules}\n\n${deckSummary(deck, lang)}\n\n${fr ? "DISPONIBLES" : "AVAILABLE"}:\n${benchList(avail, lang, 45)}`;
  return [{ role: "system", content: system }, ...history.slice(-8)];
}

/** Retire un éventuel raisonnement (« thinking ») qui aurait fuité dans le texte. */
export function stripThinking(text) {
  return (text || "")
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<\|channel\>[\s\S]*?<channel\|>/g, "")
    .trim();
}

/** Extrait le bloc JSON d'échanges. Retourne { text, changes } (changes = null si absent ou invalide). */
export function parseChanges(text) {
  const m = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) || text.match(/(\{\s*"(?:remove|add)"[\s\S]*\})\s*$/);
  if (!m) return { text, changes: null };
  try {
    const changes = JSON.parse(m[1]);
    const ok = Array.isArray(changes.remove || []) && Array.isArray(changes.add || []);
    return { text: text.replace(m[0], "").trim(), changes: ok ? { remove: changes.remove || [], add: changes.add || [] } : null };
  } catch {
    return { text, changes: null };
  }
}

/** Filet de sécurité : remplace les noms de cartes de l'autre langue par ceux de la langue choisie. */
export function localize(text, cards, lang) {
  const pairs = new Map();
  for (const c of cards) {
    const fr = c.fr?.name || BASICS_FR[c.name];
    if (!fr || fr === c.name) continue;
    if (lang === "fr") pairs.set(c.name, fr); else pairs.set(fr, c.name);
  }
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const [src, dst] of [...pairs].sort((a, b) => b[0].length - a[0].length)) {
    if (src.length > 3) text = text.replace(new RegExp(`(?<![\\p{L}'])${esc(src)}(?![\\p{L}'])`, "gu"), dst);
  }
  return text;
}

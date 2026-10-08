// Assistant de deck : analyse et chat, branchés sur le moteur local.
// Les échanges proposés par l'IA ne sont jamais appliqués tels quels : la couche core les valide.
import { relevance } from "../core/wishes.js";
import { generate } from "./engine.js";
import { chatMessages, estimateTokens, explainMessages, fitChatMessages, isRunaway, localize, parseChanges, stripThinking, visibleText } from "./prompts.js";

/** Analyse du deck. `freeCollection` = cartes libres (pour proposer des échanges réalistes). */
export async function explain(model, deck, freeCollection, lang, { onToken, signal } = {}) {
  const inDeck = new Set(deck.cards.map(c => c.name));
  const bench = freeCollection
    .filter(c => !inDeck.has(c.name) && (c.color_identity || []).every(x => deck.identity.includes(x)) && !c.type_line.includes("Land"))
    .sort((a, b) => (a.edhrec_rank || 1e9) - (b.edhrec_rank || 1e9));
  const known = [...deck.cards, ...freeCollection, ...(deck.commander ? [deck.commander] : [])];
  const fix = t => localize(stripThinking(t), known, lang);
  let messages = explainMessages(deck, bench, lang);
  if (estimateTokens(messages) > model.maxNumTokens - 1100) messages = explainMessages(deck, bench.slice(0, 8), lang);
  const text = await generate(model, messages, { onToken: t => onToken?.(fix(t)), signal, shouldStop: isRunaway });
  return fix(text);
}

/** Cartes classées par pertinence pour un texte libre (puis par popularité). */
function rankByRelevance(cards, focus) {
  return cards
    .map(c => ({ c, r: relevance(c, focus) }))
    .filter(x => x.r > 0.3)
    .sort((a, b) => b.r - a.r || (a.c.edhrec_rank || 1e9) - (b.c.edhrec_rank || 1e9))
    .map(x => x.c);
}

/**
 * Tour de chat. Retourne { text, changes } — changes à valider via deckService.swap.
 * `everything` = toute la collection libre (pour repérer les cartes pertinentes hors couleurs).
 */
export async function chat(model, deck, available, history, lang, { onToken, signal, everything = [], mentioned = [] } = {}) {
  const lastUser = [...history].reverse().find(m => m.role === "user")?.content || "";
  const focus = [lastUser, deck.wish?.text].filter(Boolean).join(" ");
  const popular = [...available].sort((a, b) => (a.edhrec_rank || 1e9) - (b.edhrec_rank || 1e9));
  const relevant = rankByRelevance(available, focus);
  const inColor = c => (c.color_identity || []).every(x => deck.identity.includes(x));
  const outOfColor = rankByRelevance(everything.filter(c => !inColor(c) && c.legalities?.[deck.format] === "legal"), focus).slice(0, 8);

  const known = [...deck.cards, ...available, ...everything, ...mentioned, ...(deck.commander ? [deck.commander] : [])];
  const fix = t => localize(stripThinking(t), known, lang);
  // contexte du modèle = prompt + réponse : on garde de la place pour répondre
  const maxOutputTokens = 900;
  const budget = model.maxNumTokens - maxOutputTokens - 150;
  const messages = fitChatMessages(limits => chatMessages(deck, popular, history, lang, { relevant, outOfColor, mentioned, limits }), budget);
  const raw = await generate(model, messages, {
    onToken: t => onToken?.(fix(visibleText(t))), signal, maxOutputTokens, shouldStop: isRunaway,
  });
  const clean = stripThinking(raw);
  if (isRunaway(clean)) return { text: fix(visibleText(clean)), changes: null, runaway: true };
  const { text, changes } = parseChanges(clean);
  return { text: fix(visibleText(text)), changes, runaway: false };
}

// ------------------------------------------------------------ cartes citées dans un message
const fold = s => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const QUESTION_WORDS = new Set(("est elle il ce un une le la les des de du au aux bon bonne bons choix carte cartes si ajoute ajouter " +
  "ajoutes mets mettre dans mon ma mes deck interessante interessant que quoi penses pense tu vaut vaudrait avis sur " +
  "is it a an the good choice card add put in my deck worth what about do you think should i").split(" "));

/** Cartes de la collection dont le nom (FR ou EN) apparaît dans le message. */
export function mentionedInCollection(text, collection) {
  const t = ` ${fold(text)} `;
  return collection.filter(c => [c.name, c.fr?.name].filter(Boolean).some(n => {
    const f = fold(n.split(" // ")[0]);
    return f.length >= 4 && t.includes(` ${f} `);
  }));
}

/** Nom de carte probable dans une question (« olivia mariée écarlate est elle un bon choix » → « olivia mariee ecarlate »). */
export function candidateName(text) {
  const quoted = text.match(/["«“]([^"»”]{3,60})["»”]/);
  if (quoted) return quoted[1].trim();
  const words = fold(text).split(" ").filter(w => w && !QUESTION_WORDS.has(w));
  return words.length && words.length <= 7 ? words.join(" ") : null;
}

/** Le nom trouvé ressemble-t-il vraiment à ce que le joueur a tapé ? (évite qu'une faute de frappe devienne une carte) */
export function looksLike(candidate, card) {
  const words = fold(candidate).split(" ").filter(w => w.length >= 3);
  if (!words.length) return false;
  const names = [card.name, card.fr?.name].filter(Boolean).map(n => fold(n).split(" "));
  return names.some(nw => words.filter(w => nw.some(x => x.startsWith(w.slice(0, Math.max(3, w.length - 2))))).length / words.length >= 0.7);
}

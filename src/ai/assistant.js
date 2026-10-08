// Assistant de deck : analyse et chat, branchés sur le moteur local.
// Les échanges proposés par l'IA ne sont jamais appliqués tels quels : la couche core les valide.
import { generate } from "./engine.js";
import { chatMessages, explainMessages, localize, parseChanges, stripThinking } from "./prompts.js";

/** Analyse du deck. `freeCollection` = cartes libres (pour proposer des échanges réalistes). */
export async function explain(model, deck, freeCollection, lang, { onToken, signal } = {}) {
  const inDeck = new Set(deck.cards.map(c => c.name));
  const bench = freeCollection
    .filter(c => !inDeck.has(c.name) && (c.color_identity || []).every(x => deck.identity.includes(x)) && !c.type_line.includes("Land"))
    .sort((a, b) => (a.edhrec_rank || 1e9) - (b.edhrec_rank || 1e9));
  const known = [...deck.cards, ...freeCollection, ...(deck.commander ? [deck.commander] : [])];
  const fix = t => localize(stripThinking(t), known, lang);
  const text = await generate(model, explainMessages(deck, bench, lang), { onToken: t => onToken?.(fix(t)), signal });
  return fix(text);
}

/** Tour de chat. Retourne { text, changes } — changes à valider via deckService.edit. */
export async function chat(model, deck, available, history, lang, { onToken, signal, everything = [] } = {}) {
  const known = [...deck.cards, ...available, ...everything, ...(deck.commander ? [deck.commander] : [])];
  const fix = t => localize(stripThinking(t), known, lang);
  const raw = await generate(model, chatMessages(deck, available, history, lang), {
    onToken: t => onToken?.(fix(parseChanges(t).text)), signal, maxOutputTokens: 700,
  });
  const { text, changes } = parseChanges(stripThinking(raw));
  return { text: fix(text), changes };
}

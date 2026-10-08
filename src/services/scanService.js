// Identification d'une carte scannée à partir du texte lu par l'OCR.
import * as core from "../core/index.js";
import { cardByReadName, printByNumber } from "../data/scryfall/index.js";

const memo = new Map(); // texte lu → résultat (évite de redemander Scryfall à chaque image)
const remember = (k, v) => { memo.set(k, v); if (memo.size > 200) memo.delete(memo.keys().next().value); return v; };

/**
 * { title, footer } (textes bruts de l'OCR) → { card, how: "footer" | "name" | "local", key } ou null.
 * knownSets : codes d'extension valides ; localCards : collection (repli hors ligne / noms mal lus).
 */
export async function identify({ title, footer }, { lang = "fr", knownSets = new Set(), localCards = [] } = {}) {
  const name = core.cleanTitle(title);
  const foot = core.parseFooter(footer, knownSets);
  const matchesName = card => !name || Math.max(core.similarity(name, card.name), core.similarity(name, card.fr?.name), core.similarity(name, card.printed_name)) >= 0.45;

  if (foot) {
    const k = `f:${foot.set}:${foot.number}:${foot.lang}`;
    const card = memo.has(k) ? memo.get(k) : remember(k, await printByNumber(foot.set, foot.number, foot.lang));
    if (card && matchesName(card)) return { card, how: "footer", key: `${card.set}:${card.name}` };
  }
  if (!name) return null;
  const k = `n:${name.toLowerCase()}`;
  let card = memo.has(k) ? memo.get(k) : remember(k, await cardByReadName(name, lang));
  // la recherche floue peut renvoyer n'importe quoi sur un texte abîmé : on vérifie la ressemblance
  if (card && Math.max(core.similarity(name, card.name), core.similarity(name, card.fr?.name), core.similarity(name, card.printed_name)) < 0.6) card = null;
  if (card) return { card, how: "name", key: `${card.set}:${card.name}` };
  const local = core.bestNameMatch(name, localCards, 0.8);
  return local ? { card: local.card, how: "local", key: `${local.card.set}:${local.card.name}` } : null;
}

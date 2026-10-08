// Construction des prompts et lecture des réponses de l'IA. Pur (testé dans tests/ai/prompts.test.js).
// Gemma 4 E2B est un petit modèle : listes courtes, consignes simples, format de sortie strict.
import { BASICS_FR } from "../core/cards.js";

export const displayName = (card, lang) =>
  lang === "fr" ? card.fr?.name || BASICS_FR[card.name] || card.name : card.name;
const displayText = (card, lang) => (lang === "fr" ? card.fr?.text || card.oracle_text || "" : card.oracle_text || "");

const ROLE_FR = { creature: "créature", ramp: "ramp", draw: "pioche", removal: "removal", wipe: "wipe", other: "autre", land: "terrain" };

function deckSummary(deck, lang) {
  const fr = lang === "fr";
  const lines = deck.cards.map(c => `${c.count}x ${displayName(c, lang)} (${fr ? ROLE_FR[c.category] || c.category : c.category}, ${c.cmc})${c.wish && deck.wish ? " ★" : ""}${c.missing ? (fr ? " [à acheter]" : " [to buy]") : ""}`);
  const head = [
    `Format: ${deck.format}`,
    `${fr ? "Couleurs" : "Colors"}: ${deck.identity.join("") || "C"}`,
    deck.commander ? `${fr ? "Commandant" : "Commander"}: ${displayName(deck.commander, lang)} — ${displayText(deck.commander, lang).slice(0, 220)}` : "",
    `${fr ? "Courbe" : "Curve"}: ${Object.entries(deck.curve || {}).map(([k, v]) => `${k}:${v}`).join(" ")} (${fr ? "moyenne" : "avg"} ${deck.avg_cmc})`,
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

const colorTag = c => (c.color_identity || []).join("") || "C";
const cardLine = (c, lang, withText, textLen = 110) =>
  `- ${displayName(c, lang)} (${c.type_line.split("—")[0].trim()}, ${c.cmc}${withText ? `, ${colorTag(c)}` : ""})` +
  (withText ? ` : ${displayText(c, lang).replace(/\s+/g, " ").slice(0, textLen)}` : "");

function mentionLine(m, deck, lang, textLen = 260) {
  const fr = lang === "fr";
  const inColors = (m.color_identity || []).every(x => deck.identity.includes(x));
  const legal = m.legalities?.[deck.format] === "legal";
  const inDeck = deck.cards.some(c => c.name === m.name) || deck.commander?.name === m.name;
  const status = [
    inDeck ? (fr ? "DÉJÀ DANS LE DECK" : "ALREADY IN THE DECK") : (fr ? "pas dans le deck" : "not in the deck"),
    m.owned ? (fr ? `possédée ×${m.owned}` : `owned ×${m.owned}`) : (fr ? "pas dans ma collection (à acheter)" : "not in my collection (to buy)"),
    inColors ? (fr ? "dans les couleurs du deck" : "in the deck's colors") : (fr ? `HORS couleurs (${colorTag(m)})` : `OFF-color (${colorTag(m)})`),
    legal ? (fr ? `légale en ${deck.format}` : `legal in ${deck.format}`) : (fr ? `ILLÉGALE en ${deck.format}` : `NOT legal in ${deck.format}`),
    m.price_eur != null ? `${m.price_eur} €` : "",
  ].filter(Boolean).join(", ");
  return `- ${displayName(m, lang)} — ${m.mana_cost || ""} ${m.type_line} — ${displayText(m, lang).replace(/\s+/g, " ").slice(0, textLen)} [${status}]`;
}

/**
 * Messages pour le chat : le modèle peut proposer des échanges dans un bloc JSON.
 * `relevant` = cartes disponibles les plus liées à la demande (montrées avec leur texte),
 * `outOfColor` = cartes pertinentes mais hors des couleurs du deck (pour le signaler au joueur).
 */
export const CHAT_LIMITS = [
  { history: 8, rel: 18, others: 30, text: 110, mention: 260, out: 8 },
  { history: 6, rel: 12, others: 15, text: 90, mention: 200, out: 5 },
  { history: 4, rel: 8, others: 8, text: 70, mention: 160, out: 3 },
  { history: 2, rel: 5, others: 0, text: 60, mention: 120, out: 0 },
];

export function chatMessages(deck, available, history, lang = "fr", { relevant = [], outOfColor = [], mentioned = [], limits = CHAT_LIMITS[0] } = {}) {
  const fr = lang === "fr";
  const colors = deck.identity.join("") || "C";
  const cmd = deck.format === "commander";
  const colorRuleFr = cmd
    ? `- le deck est en couleurs ${colors}, fixées par le commandant : si le thème demandé est surtout dans d'autres couleurs, dis-le et conseille de changer de commandant ;`
    : `- le deck est en couleurs ${colors} : si le joueur VEUT ajouter une couleur, propose les échanges avec des cartes de cette couleur (listes HORS COULEURS ou MENTIONNÉES) : l'appli lui proposera d'ajouter la couleur et rééquilibrera les terrains ; sinon, signale simplement les cartes hors couleurs ;`;
  const colorRuleEn = cmd
    ? `- the deck is ${colors}, set by the commander: if the requested theme is mostly in other colors, say so and suggest another commander;`
    : `- the deck is ${colors}: if the player WANTS to add a color, propose swaps with cards of that color (OFF-COLOR or MENTIONED lists): the app will offer to add the color and rebalance the lands; otherwise just point out off-color cards;`;
  const rules = fr
    ? `Tu aides le joueur à améliorer SON deck, construit uniquement avec SA collection. Réponds en français, brièvement.
Si le joueur demande une modification, propose 1 à 4 échanges puis termine par un bloc JSON EXACTEMENT de cette forme :
\`\`\`json
{"remove":[{"name":"Nom","count":1}],"add":[{"name":"Nom","count":1}]}
\`\`\`
Règles :
- n'ajoute QUE des cartes des listes PERTINENTES ou DISPONIBLES, avec leur nom exact ; ne retire que des cartes du DECK ;
- autant d'exemplaires retirés qu'ajoutés (sinon les retraits en trop sont ignorés) ; en Commander count vaut 1 ;
${colorRuleFr}
- les cartes ★ du deck correspondent au souhait du joueur : ne les retire pas ;
- les CARTES MENTIONNÉES (jointes par le joueur, ou trouvées sur Scryfall par l'appli pour sa demande) sont décrites ci-dessous : quand il dit « cette carte » ou « la carte jointe », il parle d'elles ; leur statut (dans le deck ou non, possédée ou non) est exact : évalue-les (rôle, synergie avec le deck) ; si le joueur veut l'ajouter et qu'elle est légale, propose l'échange (elle sera ajoutée « à acheter » si elle n'est pas possédée) ;
- tu ne peux pas chercher toi-même sur Internet : utilise les cartes listées ; s'il n'y a aucune carte adaptée, dis-le simplement, sans JSON ;
- les lignes « Résultat » de l'historique indiquent ce qui a vraiment été appliqué ou refusé : tiens-en compte.`
    : `You help the player improve THEIR deck, built only from THEIR collection. Answer in English, briefly.
If the player asks for a change, propose 1 to 4 swaps then end with a JSON block EXACTLY like:
\`\`\`json
{"remove":[{"name":"Name","count":1}],"add":[{"name":"Name","count":1}]}
\`\`\`
Rules:
- only add cards from the RELEVANT or AVAILABLE lists, with their exact name; only remove cards from the DECK;
- remove as many copies as you add (extra removals are ignored); in Commander count is 1;
${colorRuleEn}
- ★ deck cards match the player's wish: do not remove them;
- MENTIONED CARDS (attached by the player, or found on Scryfall by the app for the request) are described below: "this card" or "the attached card" refers to them; their status (in the deck or not, owned or not) is exact: evaluate them (role, synergy with the deck); if the player wants it and it is legal, propose the swap (it will be added "to buy" if not owned);
- you cannot search the Internet yourself: use the listed cards; if no card fits, just say so, without JSON;
- "Result" lines in the history show what was really applied or refused: take them into account.`;
  const inDeck = new Set(deck.cards.map(c => c.name));
  const rel = relevant.filter(c => !inDeck.has(c.name)).slice(0, limits.rel);
  const relNames = new Set(rel.map(c => c.name));
  const others = available.filter(c => !inDeck.has(c.name) && !relNames.has(c.name)).slice(0, limits.others);
  const sections = [
    rules, deckSummary(deck, lang),
    rel.length ? `${fr ? "PERTINENTES pour la demande (avec leur texte)" : "RELEVANT to the request (with text)"}:\n${rel.map(c => cardLine(c, lang, true, limits.text)).join("\n")}` : "",
    others.length ? `${fr ? "DISPONIBLES" : "AVAILABLE"}:\n${others.map(c => cardLine(c, lang, false)).join("\n")}` : "",
    mentioned.length ? `${fr ? "CARTES MENTIONNÉES" : "MENTIONED CARDS"}:\n${mentioned.map(m => mentionLine(m, deck, lang, limits.mention)).join("\n")}` : "",
    outOfColor.length && limits.out ? `${cmd
      ? (fr ? `PERTINENTES MAIS HORS DES COULEURS ${colors} (impossibles à ajouter, à signaler)` : `RELEVANT BUT NOT IN ${colors} (cannot be added, mention them)`)
      : (fr ? `HORS COULEURS ${colors} (ajoutables seulement si le joueur ajoute leur couleur)` : `OFF-COLOR ${colors} (addable only if the player adds their color)`)}:\n${outOfColor.slice(0, limits.out).map(c => cardLine(c, lang, true, limits.text)).join("\n")}` : "",
  ].filter(Boolean);
  // historique récent, messages longs raccourcis (le contexte du modèle est limité)
  const recent = history.slice(-limits.history).map((m, i, arr) =>
    i === arr.length - 1 ? m : { ...m, content: m.content.length > 600 ? m.content.slice(0, 600) + "…" : m.content });
  return [{ role: "system", content: sections.join("\n\n") }, ...recent];
}

/** Estimation prudente du nombre de tokens (≈ 3 caractères par token en français). */
export const estimateTokens = messages => Math.ceil(messages.reduce((a, m) => a + m.content.length + 12, 0) / 3);

/** Construit les messages du chat en réduisant le contexte jusqu'à tenir dans le budget de tokens. */
export function fitChatMessages(build, budget) {
  let msgs;
  for (const limits of CHAT_LIMITS) {
    msgs = build(limits);
    if (estimateTokens(msgs) <= budget) return msgs;
  }
  return msgs; // dernier recours : le plus compact
}

/** Retire un éventuel raisonnement (« thinking ») qui aurait fuité dans le texte. */
export function stripThinking(text) {
  return (text || "")
    .replace(/^\s*(Résultat|Result)\s*:.*$/gim, "") // le modèle imite parfois nos lignes internes
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<\|channel\>[\s\S]*?<channel\|>/g, "")
    .trim();
}

export const MAX_SWAPS = 6;

/** Le modèle part-il en boucle ? (bloc JSON démesuré, ou même ligne répétée) */
export function isRunaway(text) {
  const json = text.split(/```json/i)[1];
  if (json && (json.match(/"name"/g) || []).length > MAX_SWAPS * 2 + 2) return true;
  const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 20);
  const counts = {};
  for (const l of lines) if ((counts[l] = (counts[l] || 0) + 1) >= 4) return true;
  return false;
}

/** Texte à afficher pendant la génération : on masque un bloc JSON pas encore terminé. */
export function visibleText(text) {
  const i = text.search(/```json/i);
  if (i >= 0 && !/```json[\s\S]*?```/i.test(text)) return text.slice(0, i).trim();
  return parseChanges(text).text;
}

/** Extrait le bloc JSON d'échanges. Retourne { text, changes } (changes = null si absent ou invalide). */
export function parseChanges(text) {
  const m = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) || text.match(/(\{\s*"(?:remove|add)"[\s\S]*\})\s*$/);
  if (!m) return { text, changes: null };
  try {
    const raw = JSON.parse(m[1]);
    // le modèle écrit parfois « N/A », « aucun »… : ce ne sont pas des cartes
    const valid = e => e && typeof e.name === "string" && !/^\s*(n\/?a|none|aucune?|null|undefined|-|\?|nom|name|carte)?\s*$/i.test(e.name);
    const changes = { remove: (raw.remove || []).filter(valid), add: (raw.add || []).filter(valid) };
    if (!changes.remove.length && !changes.add.length) return { text: text.replace(m[0], "").trim(), changes: null };
    const ok = Array.isArray(changes.remove || []) && Array.isArray(changes.add || [])
      && (changes.remove || []).length <= MAX_SWAPS && (changes.add || []).length <= MAX_SWAPS;
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
    const [src, dst] = lang === "fr" ? [c.name, fr] : [fr, c.name];
    if (dst.includes(src)) continue; // remplacer créerait un doublon (« FR FR … »)
    pairs.set(src, dst);
  }
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const [src, dst] of [...pairs].sort((a, b) => b[0].length - a[0].length)) {
    if (src.length > 3) text = text.replace(new RegExp(`(?<![\\p{L}'])${esc(src)}(?![\\p{L}'])`, "gu"), dst);
  }
  return text;
}

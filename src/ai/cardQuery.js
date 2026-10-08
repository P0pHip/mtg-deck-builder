// Transforme une demande du joueur (« ajoute des soldats blancs ») en recherche Scryfall.
// Pur et testé : c'est l'appli, pas le petit modèle, qui décide de chercher hors collection.
import { TRIBES, wishProfile } from "../core/wishes.js";

const COLOR_WORDS = [
  [/\bblanc(he)?s?\b|\bwhite\b/, "W"], [/\bbleue?s?\b|\bblue\b/, "U"], [/\bnoire?s?\b|\bblack\b/, "B"],
  [/\brouges?\b|\bred\b/, "R"], [/\bverte?s?\b|\bgreen\b/, "G"],
];
const ACTION = /\b(ajout|ajoute|cherch|trouv|propos|sugg[eè]r|recommand|conseill|mets?|met\b|il me faut|besoin|api|scryfall|internet|add|find|search|look for|recommend|suggest|need)/i;

// thèmes du souhait → critères Scryfall
const THEME_QUERY = {
  tokens: 'o:"token"', sacrifice: "o:sacrifice", "+1/+1": 'o:"+1/+1 counter"', "cimetière": "o:graveyard",
  vol: "kw:flying", artefacts: "t:artifact", enchantements: "t:enchantment", "gain de vie": 'o:"gain" o:"life"',
  pioche: 'o:"draw"', removal: '(o:"destroy target" or o:"exile target" or o:"damage to any target")',
  "contrôle": 'o:"counter target"', ramp: 'o:"add {"', terrains: "o:landfall", burn: 'o:"damage to any target"', meule: "o:mill",
};

// mots de la demande qui ne décrivent pas une carte
const FILLER = /^(ajout|cherch|trouv|propos|sugg|recommand|conseill|mets|mettre|met|moi|toi|nous|vous|cree|creer|crees|creent|creez|genere|generent|produi|faire|fais|fait|font|donne|donnent|ont|sont|avec|quelques|plusieurs|bons?|bonnes?|meilleur|api|scryfall|internet|fumier|stp|merci|svp|please|add|find|search|look|need|some|good|best|cards?|make|create)/;

/** Distance d'édition (pour tolérer une faute de frappe sur un type de créature : « soldtats »). */
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const fuzzyTribe = w => {
  if (w.length < 5) return null;
  const base = w.replace(/s$/, "");
  const hit = Object.keys(TRIBES).find(k => k.length >= 4 && editDistance(base, k) <= (k.length >= 7 ? 2 : 1));
  return hit ? TRIBES[hit] : null;
};

const fold = s => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Requête Scryfall pour la demande, ou null si ce n'est pas une demande de cartes.
 * Toujours limitée au format du deck. Retourne { query, colors, criteria } (criteria = ce qui a été compris).
 */
export function cardQuery(text, deck) {
  if (!text || !ACTION.test(text)) return null;
  const t = fold(text);
  const prof = wishProfile(text) || { themes: [], tribes: [], terms: [] };
  const colors = COLOR_WORDS.filter(([rx]) => rx.test(t)).map(([, c]) => c);
  const parts = [], criteria = [];
  for (const tribe of prof.tribes) { parts.push(`t:${tribe.toLowerCase()}`); criteria.push(tribe); }
  for (const [label] of prof.themes) if (THEME_QUERY[label]) { parts.push(THEME_QUERY[label]); criteria.push(label); }
  const tribes = new Set(prof.tribes);
  for (const term of prof.terms || []) {
    if (COLOR_WORDS.some(([rx]) => rx.test(term.label)) || FILLER.test(term.label)) continue;
    const tribe = fuzzyTribe(term.label);
    if (tribe) { if (!tribes.has(tribe)) { tribes.add(tribe); parts.push(`t:${tribe.toLowerCase()}`); criteria.push(tribe); } continue; }
    parts.push(`o:"${term.en}"`); criteria.push(term.label);
  }
  if (!parts.length) return null; // rien de concret à chercher (« cherche dans l'api » seul)
  const colorPart = colors.length ? `c>=${colors.join("")}` : `id<=${deck.identity.join("") || "C"}`;
  if (colors.length) criteria.push(colors.join(""));
  return { query: `${parts.join(" ")} ${colorPart} f:${deck.format} -t:basic game:paper`, colors, criteria };
}

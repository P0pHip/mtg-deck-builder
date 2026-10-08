// Souhaits du joueur (texte libre FR/EN) → profil de thèmes, tribus et style.
import { r2, subtypes } from "./cards.js";

// mots-clés de souhaits (FR / EN) -> [regex sur le souhait, libellé, regex sur texte+type de la carte]
const WISH_THEMES = [
  [/token|jeton/, "tokens", /token/i],
  [/sacrifi/, "sacrifice", /sacrifice/i],
  [/\+1\/\+1|marqueur|counter on|compteur/, "+1/+1", /\+1\/\+1 counter|proliferate/i],
  [/cimeti|graveyard|reanim|réanim/, "cimetière", /graveyard/i],
  [/\bvol\b|volant|flying|flyer|oiseau/, "vol", /flying/i],
  [/artefact|artifact/, "artefacts", /artifact/i],
  [/enchant/, "enchantements", /enchantment/i],
  [/\bvie\b|life|lifelink|lien de vie/, "gain de vie", /gain .* life|lifelink/i],
  [/pioche|draw|carte en main/, "pioche", /draw/i],
  [/removal|destruc|tuer|kill|exil/, "removal", /destroy target|exile target|damage to (any|target)/i],
  [/contr[oô]le|control|contre|counterspell/, "contrôle", /counter target|draw/i],
  [/ramp|mana|accél/, "ramp", /add \{|search your library for .*land/i],
  [/terrain|landfall|land/, "terrains", /landfall|land enters/i],
  [/burn|brûl|dégât|damage/, "burn", /damage to (any target|each opponent|target player)/i],
  [/mill|meule/, "meule", /mill|into .* graveyard from .* library/i],
];
export const TRIBES = {
  elf: "Elf", elfe: "Elf", gobelin: "Goblin", goblin: "Goblin", dragon: "Dragon", vampire: "Vampire",
  ange: "Angel", angel: "Angel", zombie: "Zombie", humain: "Human", human: "Human", chevalier: "Knight",
  knight: "Knight", soldat: "Soldier", soldier: "Soldier", ondin: "Merfolk", merfolk: "Merfolk",
  sorcier: "Wizard", wizard: "Wizard", chat: "Cat", cat: "Cat", dinosaure: "Dinosaur", dinosaur: "Dinosaur",
  pirate: "Pirate", faerie: "Faerie", "fée": "Faerie", "slivoïde": "Sliver", sliver: "Sliver",
  "démon": "Demon", demon: "Demon",
};
const AGGRO = /agress|aggro|rapide|fast|tempo|rush|bas de courbe|low curve|beatdown/;

// Mots libres du souhait (« jetons sang », « trésors », « indices »…) : cherchés dans le texte des cartes.
// Mots vides ignorés, et petit dictionnaire FR → EN pour le texte Oracle anglais.
const STOP = new Set(("deck decks avec sans pour plus moins tres bien beaucoup des les une le la de du et ou sur dans qui que " +
  "mon mes ton tes son ses faire fais veux voudrais aimerais jeu cartes carte theme base axe autour style type genre " +
  "jouer joue with the and for more less based around build make want cards card play deck").split(" "));
const TERM_EN = {
  sang: "blood", tresor: "treasure", tresors: "treasure", nourriture: "food", indice: "clue", indices: "clue",
  mort: "dies", morts: "dies", meurt: "dies", poison: "poison", infection: "toxic", equipement: "equipment",
  equipements: "equipment", vehicule: "vehicle", vehicules: "vehicle", pilote: "crew", aventure: "adventure",
  rituel: "sorcery", rituels: "sorcery", ephemere: "instant", ephemeres: "instant", copie: "copy", copies: "copy",
  defausse: "discard", energie: "energy", ninjutsu: "ninjutsu", saga: "saga", sagas: "saga", proliferation: "proliferate",
  pieges: "trap", "piège": "trap", vol: "flying", raid: "raid", chaman: "shaman", lutin: "faerie", golem: "golem",
};
const fold = s => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const escapeRx = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function freeTerms(text, consumed) {
  const quoted = new Set([...text.matchAll(/["«“']\s*([^"»”']+?)\s*["»”']/g)].flatMap(m => fold(m[1]).split(/[^\p{L}0-9]+/u)));
  const words = [...new Set(fold(text).split(/[^\p{L}0-9]+/u))].filter(w => w.length >= 3 && !STOP.has(w) && !consumed(w));
  return words.map(w => {
    const en = TERM_EN[w] || (w.endsWith("s") && TERM_EN[w.slice(0, -1)]) || null;
    const stems = [...new Set([w.replace(/s$/, ""), en].filter(Boolean))];
    return { label: w, en: en || w.replace(/s$/, ""), rx: new RegExp(`(^|[^\\p{L}])(${stems.map(escapeRx).join("|")})`, "iu"), weight: quoted.has(w) ? 0.6 : 0.4 };
  });
}

/** Texte cherchable d'une carte (EN + FR), sans son propre nom (« Blood Artist » ne parle pas de jetons Sang). */
function searchableText(card) {
  let en = (card.oracle_text || "") + " " + (card.type_line || "");
  for (const n of card.name.split(" // ")) en = en.split(n).join("~");
  let fr = (card.fr?.text || "") + " " + (card.fr?.type_line || "");
  for (const n of (card.fr?.name || "").split(" // ").filter(Boolean)) fr = fr.split(n).join("~");
  return fold(en + " " + fr);
}

export function wishProfile(text) {
  const t = (text || "").toLowerCase();
  if (!t.trim()) return null;
  const themes = WISH_THEMES.filter(([kw]) => kw.test(t)).map(([, label, rx]) => [label, rx]);
  const tribes = [...new Set(Object.entries(TRIBES)
    .filter(([k]) => new RegExp(`(^|[^\\p{L}])${k}s?($|[^\\p{L}])`, "u").test(t)).map(([, v]) => v))].sort();
  const tribeKeys = Object.keys(TRIBES).map(fold);
  const consumed = w => WISH_THEMES.some(([kw]) => kw.test(w)) || AGGRO.test(w) || tribeKeys.some(k => w === k || w === k + "s");
  const terms = freeTerms(text, consumed);
  return { text: text.trim(), themes, tribes, aggro: AGGRO.test(t), terms };
}

/** Part du bonus due aux mots libres du souhait (« sang », « trésors »…). */
export function termBonus(card, prof) {
  if (!prof?.terms?.length) return 0;
  const st = searchableText(card);
  return prof.terms.reduce((b, term) => b + (term.rx.test(st) ? term.weight : 0), 0);
}

export function wishBonus(card, prof) {
  if (!prof) return 0;
  const txt = card.oracle_text + " " + card.type_line;
  let b = prof.themes.filter(([, rx]) => rx.test(txt)).length * 0.35;
  if (prof.tribes.length && (prof.tribes.some(tr => subtypes(card).has(tr)) ||
      prof.tribes.some(tr => txt.toLowerCase().includes(tr.toLowerCase())))) b += 0.5;
  b += termBonus(card, prof);
  if (prof.aggro) {
    b += card.cmc <= 2 && card.type_line.includes("Creature") ? 0.25 : 0;
    b -= Math.max(0, card.cmc - 3) * 0.1;
  }
  return Math.min(b, 1);
}

export function wishSummary(prof, chosen) {
  if (!prof) return null;
  const nonland = chosen.filter(c => c.category !== "land");
  const fit = nonland.filter(c => c.wish).length / Math.max(nonland.length, 1);
  return { text: prof.text, matched: [...prof.themes.map(([l]) => l), ...prof.tribes, ...(prof.aggro ? ["aggro"] : []), ...(prof.terms || []).map(x => x.label)], fit: r2(fit) };
}


/** Pertinence d'une carte pour un texte libre (message du chat) : utilisé pour choisir quelles cartes montrer à l'IA. */
export function relevance(card, text) {
  const prof = wishProfile(text);
  return prof ? wishBonus(card, { ...prof, aggro: false }) : 0;
}

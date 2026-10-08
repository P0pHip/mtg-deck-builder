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
const TRIBES = {
  elf: "Elf", elfe: "Elf", gobelin: "Goblin", goblin: "Goblin", dragon: "Dragon", vampire: "Vampire",
  ange: "Angel", angel: "Angel", zombie: "Zombie", humain: "Human", human: "Human", chevalier: "Knight",
  knight: "Knight", soldat: "Soldier", soldier: "Soldier", ondin: "Merfolk", merfolk: "Merfolk",
  sorcier: "Wizard", wizard: "Wizard", chat: "Cat", cat: "Cat", dinosaure: "Dinosaur", dinosaur: "Dinosaur",
  pirate: "Pirate", faerie: "Faerie", "fée": "Faerie", "slivoïde": "Sliver", sliver: "Sliver",
  "démon": "Demon", demon: "Demon",
};
const AGGRO = /agress|aggro|rapide|fast|tempo|rush|bas de courbe|low curve|beatdown/;

export function wishProfile(text) {
  const t = (text || "").toLowerCase();
  if (!t.trim()) return null;
  const themes = WISH_THEMES.filter(([kw]) => kw.test(t)).map(([, label, rx]) => [label, rx]);
  const tribes = [...new Set(Object.entries(TRIBES)
    .filter(([k]) => new RegExp(`(^|[^\\p{L}])${k}s?($|[^\\p{L}])`, "u").test(t)).map(([, v]) => v))].sort();
  return { text: text.trim(), themes, tribes, aggro: AGGRO.test(t) };
}

export function wishBonus(card, prof) {
  if (!prof) return 0;
  const txt = card.oracle_text + " " + card.type_line;
  let b = prof.themes.filter(([, rx]) => rx.test(txt)).length * 0.35;
  if (prof.tribes.length && (prof.tribes.some(tr => subtypes(card).has(tr)) ||
      prof.tribes.some(tr => txt.toLowerCase().includes(tr.toLowerCase())))) b += 0.5;
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
  return { text: prof.text, matched: [...prof.themes.map(([l]) => l), ...prof.tribes, ...(prof.aggro ? ["aggro"] : [])], fit: r2(fit) };
}


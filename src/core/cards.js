// Domaine « carte » : constantes, rôles, qualité, types. Fonctions pures (aucun accès DOM / réseau).
export const COLORS = "WUBRG";
export const BASICS = { W: "Plains", U: "Island", B: "Swamp", R: "Mountain", G: "Forest" };
export const BASIC_NAMES = new Set([...Object.values(BASICS), "Wastes"]);
export const BASICS_FR = { Plains: "Plaine", Island: "Île", Swamp: "Marais", Mountain: "Montagne", Forest: "Forêt", Wastes: "Désert" };

const RX = {
  wipe: /(destroy|exile) all (creatures|nonland|other creatures|permanents)|all creatures get -|deals? \d+ damage to each creature|return all nonland/i,
  ramp: /add \{|add one mana|add (two|three) mana|search your library for (a|up to \w+) (basic )?lands?|put (a|up to \w+) lands? cards? .*onto the battlefield/i,
  removal: /(destroy|exile) target|deals? (\d+|x) damage to (any target|target creature|target player or planeswalker)|counter target|return target (creature|nonland permanent).* to its owner's hand|target creature gets -\d+\/-\d+|fights? (target|another target)|target player sacrifices/i,
  draw: /draws? (a|an|two|three|four|x|that many|\w+) cards?|draw cards equal|look at the top .* put .* into your hand/i,
};

export const THEMES = {
  tokens: /token/i, sacrifice: /sacrifice/i, mort: /\bdies\b|dies,/i, "+1/+1": /\+1\/\+1 counter/i,
  counters: /counter on|proliferate/i, "cimetière": /graveyard/i, artefacts: /artifact/i,
  enchantements: /enchantment/i, terrains: /landfall|land enters/i, attaque: /attacks|combat damage/i,
  vol: /flying/i, vie: /gain .* life|lifelink/i, "trésors": /treasure/i, sorts: /instant or sorcery|noncreature spell/i,
};


export const TYPE_ORDER = ["Creature", "Planeswalker", "Battle", "Instant", "Sorcery", "Artifact", "Enchantment", "Land"];

export const r3 = x => Math.round(x * 1000) / 1000;
export const r2 = x => Math.round(x * 100) / 100;
export const front = tl => (tl || "").split("//")[0];
export const subset = (a, b) => a.every(x => b.includes(x));

// ---------------------------------------------------------------- utilitaires
export function tags(card) {
  if (front(card.type_line).includes("Land")) return ["land"];
  const out = Object.entries(RX).filter(([, rx]) => rx.test(card.oracle_text || "")).map(([k]) => k);
  if (card.type_line.includes("Creature")) out.push("creature");
  return out.length ? out : ["other"];
}

export function category(card) {
  const tg = tags(card);
  return ["land", "wipe", "ramp", "removal", "draw", "creature"].find(k => tg.includes(k)) || "other";
}

export function quality(card) {
  const r = card.edhrec_rank;
  if (!r) return 0.15;
  return Math.max(0, 1 - Math.min(r, 25000) / 25000);
}

export function subtypes(card) {
  const t = front(card.type_line);
  return new Set(t.includes("—") ? t.split("—")[1].trim().split(/\s+/) : []);
}

export const commanderThemes = cmd => Object.keys(THEMES).filter(k => THEMES[k].test(cmd.oracle_text || ""));

export function synergy(card, themes, tribes) {
  let s = 0;
  const txt = card.oracle_text || "";
  for (const th of themes) if (THEMES[th].test(txt)) s += 0.2;
  const st = subtypes(card);
  if ([...tribes].some(t => st.has(t))) s += 0.35;
  for (const tribe of tribes) if (txt.toLowerCase().includes(tribe.toLowerCase())) s += 0.2;
  return Math.min(s, 0.9);
}

export const inIdentity = (card, identity) => subset(card.color_identity || [], identity);

export function pips(cards) {
  const c = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const card of cards) for (const col of COLORS)
    c[col] += ((card.mana_cost || "").split("{" + col + "}").length - 1) * (card.count || 1);
  return c;
}

export function basicsSplit(n, pipCount, identity) {
  const ids = [...COLORS].filter(c => identity.includes(c));
  if (!ids.length) return n ? { Wastes: n } : {};
  const total = ids.reduce((a, c) => a + pipCount[c], 0) || ids.length;
  const split = Object.fromEntries(ids.map(c => [c, (pipCount[c] || total / ids.length) / total * n]));
  const res = Object.fromEntries(ids.map(c => [c, Math.floor(split[c])]));
  const left = n - Object.values(res).reduce((a, b) => a + b, 0);
  ids.sort((a, b) => (split[b] - res[b]) - (split[a] - res[a])).slice(0, left).forEach(c => res[c]++);
  return Object.fromEntries(Object.entries(res).filter(([, v]) => v).map(([c, v]) => [BASICS[c], v]));
}

export function landIsUseful(card, identity) {
  if (BASIC_NAMES.has(card.name)) return false;
  const ci = card.color_identity || [];
  if (ci.length) return subset(ci, identity) && ci.some(c => identity.includes(c));
  const txt = (card.oracle_text || "").toLowerCase();
  return ["any color", "commander", "search your library", "add {c}"].some(k => txt.includes(k));
}

export const mainType = tl => TYPE_ORDER.find(t => front(tl).includes(t)) || "Other";

export const basicEntry = (name, n) => ({
  name, count: n, cmc: 0, mana_cost: "", type_line: "Basic Land", category: "land", score: 0, price_eur: null,
  image: null, image_small: null, image_back: null, scryfall_uri: null, oracle_text: "", fr: null,
});


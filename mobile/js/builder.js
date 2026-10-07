// Moteur déterministe de construction de deck (Commander et 60 cartes).
// Portage JavaScript de builder.py (version PC) : mêmes règles, mêmes scores.

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

const THEMES = {
  tokens: /token/i, sacrifice: /sacrifice/i, mort: /\bdies\b|dies,/i, "+1/+1": /\+1\/\+1 counter/i,
  counters: /counter on|proliferate/i, "cimetière": /graveyard/i, artefacts: /artifact/i,
  enchantements: /enchantment/i, terrains: /landfall|land enters/i, attaque: /attacks|combat damage/i,
  vol: /flying/i, vie: /gain .* life|lifelink/i, "trésors": /treasure/i, sorts: /instant or sorcery|noncreature spell/i,
};

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

export const COMMANDER_TARGETS = { land: 36, ramp: 10, draw: 10, removal: 8, wipe: 2 };
const SIXTY_LANDS = 24;
const BUY_PENALTY = 0.35; // une carte à acheter doit être nettement meilleure qu'une carte possédée
export const TYPE_ORDER = ["Creature", "Planeswalker", "Battle", "Instant", "Sorcery", "Artifact", "Enchantment", "Land"];

const r3 = x => Math.round(x * 1000) / 1000;
const r2 = x => Math.round(x * 100) / 100;
const front = tl => (tl || "").split("//")[0];
const subset = (a, b) => a.every(x => b.includes(x));

// ------------------------------------------------------------------ souhaits
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

function wishSummary(prof, chosen) {
  if (!prof) return null;
  const nonland = chosen.filter(c => c.category !== "land");
  const fit = nonland.filter(c => c.wish).length / Math.max(nonland.length, 1);
  return { text: prof.text, matched: [...prof.themes.map(([l]) => l), ...prof.tribes, ...(prof.aggro ? ["aggro"] : [])], fit: r2(fit) };
}

// ------------------------------------------------------- cartes hors collection
const ownedQty = c => (c.owned_qty !== undefined ? c.owned_qty : c.quantity);
function buyPenalty(card, n) {
  const missing = Math.max(0, n - ownedQty(card));
  return BUY_PENALTY * missing / Math.max(n, 1);
}

export function mergeExternal(owned, external, cap) {
  const pool = new Map(owned.map(c => [c.name, { ...c, owned_qty: c.quantity, quantity: Math.max(c.quantity, cap) }]));
  for (const c of external) {
    if (!pool.has(c.name) && !BASIC_NAMES.has(c.name)) pool.set(c.name, { ...c, owned_qty: 0, quantity: cap, external: true });
  }
  return [...pool.values()];
}

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

const commanderThemes = cmd => Object.keys(THEMES).filter(k => THEMES[k].test(cmd.oracle_text || ""));

function synergy(card, themes, tribes) {
  let s = 0;
  const txt = card.oracle_text || "";
  for (const th of themes) if (THEMES[th].test(txt)) s += 0.2;
  const st = subtypes(card);
  if ([...tribes].some(t => st.has(t))) s += 0.35;
  for (const tribe of tribes) if (txt.toLowerCase().includes(tribe.toLowerCase())) s += 0.2;
  return Math.min(s, 0.9);
}

const inIdentity = (card, identity) => subset(card.color_identity || [], identity);

function pips(cards) {
  const c = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const card of cards) for (const col of COLORS)
    c[col] += ((card.mana_cost || "").split("{" + col + "}").length - 1) * (card.count || 1);
  return c;
}

function basicsSplit(n, pipCount, identity) {
  const ids = [...COLORS].filter(c => identity.includes(c));
  if (!ids.length) return n ? { Wastes: n } : {};
  const total = ids.reduce((a, c) => a + pipCount[c], 0) || ids.length;
  const split = Object.fromEntries(ids.map(c => [c, (pipCount[c] || total / ids.length) / total * n]));
  const res = Object.fromEntries(ids.map(c => [c, Math.floor(split[c])]));
  const left = n - Object.values(res).reduce((a, b) => a + b, 0);
  ids.sort((a, b) => (split[b] - res[b]) - (split[a] - res[a])).slice(0, left).forEach(c => res[c]++);
  return Object.fromEntries(Object.entries(res).filter(([, v]) => v).map(([c, v]) => [BASICS[c], v]));
}

function landIsUseful(card, identity) {
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

export function summarize(deckCards, fmt, extra) {
  const cards = deckCards.map(c => ({ ...c }));
  for (const c of cards) {
    if (c.owned_max !== null && c.owned_max !== undefined) {
      c.owned = Math.min(c.count, c.owned_max);
      c.missing = c.count - c.owned;
    }
  }
  const toBuy = cards.filter(c => c.missing).map(c => ({ name: c.name, count: c.missing, owned: c.owned, price_eur: c.price_eur, scryfall_uri: c.scryfall_uri }))
    .sort((a, b) => (b.price_eur || 0) - (a.price_eur || 0));
  const curve = {}; for (let k = 0; k < 8; k++) curve[k] = 0;
  const nonland = cards.filter(c => c.category !== "land");
  for (const c of nonland) curve[Math.min(Math.floor(c.cmc), 7)] += c.count;
  const nNon = nonland.reduce((a, c) => a + c.count, 0) || 1;
  const categories = {}, types = {};
  for (const c of cards) {
    categories[c.category] = (categories[c.category] || 0) + c.count;
    const t = mainType(c.type_line); types[t] = (types[t] || 0) + c.count;
  }
  return {
    ...extra,
    format: fmt,
    cards: cards.sort((a, b) => a.category.localeCompare(b.category) || a.cmc - b.cmc || a.name.localeCompare(b.name)),
    total: cards.reduce((a, c) => a + c.count, 0),
    curve, avg_cmc: r2(nonland.reduce((a, c) => a + c.cmc * c.count, 0) / nNon),
    categories, types,
    value_eur: r2(cards.reduce((a, c) => a + (c.price_eur || 0) * c.count, 0)),
    to_buy: toBuy, buy_cost: r2(toBuy.reduce((a, b) => a + (b.price_eur || 0) * b.count, 0)),
  };
}

function entry(card, count, score = 0, cat = null) {
  return {
    name: card.name, count, cmc: card.cmc, mana_cost: card.mana_cost, type_line: card.type_line,
    category: cat || category(card), score: r3(score), price_eur: card.price_eur, image: card.image,
    image_small: card.image_small, image_back: card.image_back, scryfall_uri: card.scryfall_uri,
    oracle_text: card.oracle_text, fr: card.fr || null,
    owned_max: card.owned_qty !== undefined ? card.owned_qty : null,
  };
}

// ------------------------------------------------------------------ Commander
export function commanders(collection) {
  return collection.filter(c => {
    const t = front(c.type_line);
    const ok = (t.includes("Legendary") && t.includes("Creature")) || (c.oracle_text || "").includes("can be your commander");
    return ok && c.legalities?.commander === "legal";
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export function buildCommander(collection, commanderName, wish = null) {
  const cmd = collection.find(c => c.name === commanderName);
  if (!cmd) return null;
  const identity = cmd.color_identity || [];
  const themes = commanderThemes(cmd);
  const tribes = new Set([...subtypes(cmd)].filter(t => t !== "Human" && t !== "Legendary"));
  const pool = collection.filter(c => c.name !== cmd.name && c.legalities?.commander === "legal" && inIdentity(c, identity));

  const spells = [];
  for (const c of pool) {
    if (category(c) === "land") continue;
    let s = quality(c) + synergy(c, themes, tribes);
    const wb = wishBonus(c, wish);
    if (c.cmc >= 7) s -= 0.25;
    spells.push([s + wb - buyPenalty(c, 1), s, c, wb]);
  }
  spells.sort((a, b) => b[0] - a[0]);
  const ent = (c, s, wb, role) => ({ ...entry(c, 1, s, role), wish: wb > 0.2 });

  const chosen = [], used = new Set();
  const nSpells = 99 - COMMANDER_TARGETS.land;
  for (const role of ["ramp", "draw", "removal", "wipe"]) {
    let quota = COMMANDER_TARGETS[role];
    for (const [, s, c, wb] of spells) {
      if (quota <= 0) break;
      if (!used.has(c.name) && tags(c).includes(role)) { chosen.push(ent(c, s, wb, role)); used.add(c.name); quota--; }
    }
  }
  for (const [, s, c, wb] of spells) {
    if (chosen.length >= nSpells) break;
    if (!used.has(c.name)) { chosen.push(ent(c, s, wb)); used.add(c.name); }
  }

  const nLands = COMMANDER_TARGETS.land + Math.max(0, Math.min(2, nSpells - chosen.length));
  let lands = pool.filter(c => category(c) === "land" && landIsUseful(c, identity))
    .sort((a, b) => (quality(b) - buyPenalty(b, 1)) - (quality(a) - buyPenalty(a, 1)));
  if (identity.length <= 1) lands = lands.filter(l => !l.name.includes("Command Tower"));
  const landEntries = lands.slice(0, Math.min(lands.length, nLands - 10)).map(l => entry(l, 1, quality(l), "land"));
  for (const [name, n] of Object.entries(basicsSplit(nLands - landEntries.length, pips(chosen), identity)))
    landEntries.push(basicEntry(name, n));

  const warnings = [];
  for (const role of ["ramp", "draw", "removal"]) {
    const have = chosen.filter(c => c.category === role).length;
    if (have < COMMANDER_TARGETS[role] - 2) warnings.push({ k: "fewRole", role, have, want: COMMANDER_TARGETS[role] });
  }
  const missing = 99 - chosen.length - nLands;
  if (missing > 0) warnings.unshift({ k: "incomplete", n: missing });
  const filler = chosen.filter(c => c.score < 0.2).length;
  if (filler > 15) warnings.push({ k: "filler", n: filler });

  const score = chosen.reduce((a, c) => a + c.score, 0) / Math.max(chosen.length, 1);
  return summarize([...chosen, ...landEntries], "commander", {
    commander: entry(cmd, 1, quality(cmd), "commander"), identity, themes, tribes: [...tribes].sort(),
    score: r3(score), warnings, wish: wishSummary(wish, chosen),
  });
}

export function bestCommander(collection, wish = null) {
  let best = null, bestV = -1;
  for (const c of commanders(collection)) {
    const d = buildCommander(collection, c.name, wish);
    const v = d.score + (wish ? d.wish.fit * 0.6 + wishBonus(c, wish) * 0.5 : 0);
    if (v > bestV) { best = d; bestV = v; }
  }
  return best;
}

// ------------------------------------------------------------------ 60 cartes
const sixtyPool = (collection, fmt, colors) =>
  collection.filter(c => c.legalities?.[fmt] === "legal" && inIdentity(c, colors) && !BASIC_NAMES.has(c.name));

export function buildSixty(collection, fmt, colors = null, wish = null) {
  if (!colors || !colors.length) colors = bestColors(collection, fmt, wish);
  const pool = sixtyPool(collection, fmt, colors);
  const spells = [];
  for (const c of pool) {
    if (category(c) === "land") continue;
    let s = quality(c) + (tags(c).includes("removal") ? 0.1 : 0);
    s -= Math.max(0, c.cmc - 3) * 0.12;
    const ci = c.color_identity || [];
    if (colors.length > 1 && ci.length === colors.length && subset(ci, colors)) s += 0.05;
    const wb = wishBonus(c, wish);
    spells.push([s + wb - buyPenalty(c, Math.min(c.quantity, 4)), s, c, wb]);
  }
  spells.sort((a, b) => b[0] - a[0]);

  const target = 60 - SIXTY_LANDS, caps = { 4: 8, 5: 4, 6: 2 }, usedByCmc = {};
  const chosen = []; let total = 0;
  for (const [, s, c, wb] of spells) {
    if (total >= target) break;
    const key = Math.min(Math.floor(c.cmc), 6);
    const room = key >= 4 ? caps[key] - (usedByCmc[key] || 0) : 99;
    const n = Math.min(c.quantity, 4, target - total, room);
    if (n <= 0) continue;
    chosen.push({ ...entry(c, n, s), wish: wb > 0.2 }); total += n; usedByCmc[key] = (usedByCmc[key] || 0) + n;
  }

  const lands = pool.filter(c => category(c) === "land" && landIsUseful(c, colors))
    .sort((a, b) => (quality(b) - buyPenalty(b, Math.min(b.quantity, 4))) - (quality(a) - buyPenalty(a, Math.min(a.quantity, 4))));
  const landEntries = []; let nLand = 0;
  for (const l of lands) {
    const n = Math.min(l.quantity, 4, 12 - nLand);
    if (n <= 0) break;
    landEntries.push(entry(l, n, quality(l), "land")); nLand += n;
  }
  for (const [name, n] of Object.entries(basicsSplit(SIXTY_LANDS - nLand, pips(chosen), colors))) landEntries.push(basicEntry(name, n));

  const warnings = total < target ? [{ k: "fewSpells", n: total, want: target, fmt }] : [];
  const score = chosen.reduce((a, c) => a + c.score * c.count, 0) / Math.max(total, 1);
  return summarize([...chosen, ...landEntries], fmt, {
    identity: [...COLORS].filter(c => colors.includes(c)), score: r3(score), warnings, wish: wishSummary(wish, chosen),
  });
}

function bestColors(collection, fmt, wish) {
  let best = ["R"], bestVal = -1;
  const combos = [...COLORS].map(c => [c]);
  for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) combos.push([COLORS[i], COLORS[j]]);
  for (const combo of combos) {
    const pool = sixtyPool(collection, fmt, combo).filter(c => category(c) !== "land");
    const vals = [];
    for (const c of pool) for (let k = 0; k < Math.min(c.quantity, 4); k++) vals.push(quality(c) + wishBonus(c, wish));
    vals.sort((a, b) => b - a);
    const val = vals.slice(0, 36).reduce((a, b) => a + b, 0) - (vals.length >= 36 ? 0 : (36 - vals.length) * 0.3);
    if (val > bestVal) { best = combo; bestVal = val; }
  }
  return best;
}

// ------------------------------------------------------- édition manuelle
export const legalPool = (collection, deck) =>
  collection.filter(c => c.legalities?.[deck.format] === "legal" && inIdentity(c, deck.identity) && !BASIC_NAMES.has(c.name));

const BASIC_FR_IN = { plaine: "Plains", "île": "Island", marais: "Swamp", montagne: "Mountain", "forêt": "Forest" };

export function applyChanges(deck, collection, remove = [], add = []) {
  const byName = new Map();
  for (const c of legalPool(collection, deck)) {
    byName.set(c.name.toLowerCase(), c);
    if (c.fr?.name && !byName.has(c.fr.name.toLowerCase())) byName.set(c.fr.name.toLowerCase(), c);
  }
  const singleton = deck.format === "commander";
  const cards = new Map(deck.cards.map(c => [c.name, { ...c }]));
  const log = [];

  for (const r of remove) {
    let wanted = String(r.name || "").trim().toLowerCase();
    wanted = (BASIC_FR_IN[wanted] || wanted).toLowerCase();
    const name = [...cards.keys()].find(n => n.toLowerCase() === wanted || (cards.get(n).fr?.name || "").toLowerCase() === wanted);
    if (!name) { log.push({ ok: false, k: "notInDeck", name: r.name }); continue; }
    const n = singleton ? 1 : Math.max(1, parseInt(r.count ?? cards.get(name).count, 10));
    cards.get(name).count -= n;
    if (cards.get(name).count <= 0) cards.delete(name);
    log.push({ ok: true, sign: "−", n, name });
  }

  for (const a of add) {
    const wanted = String(a.name || "").trim();
    const basic = [...BASIC_NAMES].find(b => b.toLowerCase() === wanted.toLowerCase()) || BASIC_FR_IN[wanted.toLowerCase()];
    if (basic) {
      const col = Object.keys(BASICS).find(k => BASICS[k] === basic);
      if (col && !deck.identity.includes(col)) { log.push({ ok: false, k: "offColor", name: basic }); continue; }
      const n = Math.max(1, parseInt(a.count ?? 1, 10));
      if (cards.has(basic)) cards.get(basic).count += n; else cards.set(basic, basicEntry(basic, n));
      log.push({ ok: true, sign: "+", n, name: basic }); continue;
    }
    const c = byName.get(wanted.toLowerCase());
    if (!c) { log.push({ ok: false, k: "notAvailable", name: wanted }); continue; }
    const have = cards.get(c.name)?.count || 0;
    const cap = singleton ? 1 : Math.min(c.quantity, 4);
    const n = Math.min(singleton ? 1 : Math.max(1, parseInt(a.count ?? 1, 10)), cap - have);
    if (n <= 0) { log.push({ ok: false, k: "atMax", name: c.name }); continue; }
    if (cards.has(c.name)) cards.get(c.name).count += n; else cards.set(c.name, entry(c, n, quality(c)));
    log.push({ ok: true, sign: "+", n, name: c.name });
  }

  const extra = { ...deck };
  for (const k of ["cards", "total", "curve", "avg_cmc", "categories", "value_eur", "format", "types", "to_buy", "buy_cost"]) delete extra[k];
  return { deck: summarize([...cards.values()], deck.format, extra), log };
}

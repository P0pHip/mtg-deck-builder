// Construction de decks (Commander / 60 cartes). Portage exact de la version Python : voir tests/core/builder.test.js.
import {
  BASIC_NAMES, COLORS, TYPE_ORDER, basicEntry, basicsSplit, category, commanderThemes, front, inIdentity,
  landIsUseful, mainType, pips, quality, r2, r3, subset, subtypes, synergy, tags,
} from "./cards.js";
import { termBonus, wishBonus, wishSummary } from "./wishes.js";

export const COMMANDER_TARGETS = { land: 36, ramp: 10, draw: 10, removal: 8, wipe: 2 };
const SIXTY_LANDS = 24;
const BUY_PENALTY = 0.35; // une carte à acheter doit être nettement meilleure qu'une carte possédée

// ------------------------------------------------------- cartes hors collection
export const ownedQty = c => (c.owned_qty !== undefined ? c.owned_qty : c.quantity);
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

export function entry(card, count, score = 0, cat = null) {
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
    // un mot écrit explicitement (« sang ») pèse double dans le choix des couleurs : le thème prime sur la puissance brute
    for (const c of pool) for (let k = 0; k < Math.min(c.quantity, 4); k++) vals.push(quality(c) + wishBonus(c, wish) + termBonus(c, wish));
    vals.sort((a, b) => b - a);
    const val = vals.slice(0, 36).reduce((a, b) => a + b, 0) - (vals.length >= 36 ? 0 : (36 - vals.length) * 0.3);
    if (val > bestVal) { best = combo; bestVal = val; }
  }
  return best;
}


// ------------------------------------------------------------ deck tout fait (préconstruit)
const LIST_FORMATS = ["standard", "pioneer", "modern", "pauper", "legacy"];

/**
 * Deck à partir d'une liste toute faite ([{ card, count }]), par ex. un deck préconstruit.
 * Avec un commandant : format Commander. Sinon, le format le plus restreint où toutes les cartes sont légales.
 */
export function deckFromList(list, { commander = null } = {}) {
  const spells = list.filter(x => !commander || x.card.name !== commander.name);
  const legalIn = f => spells.every(x => BASIC_NAMES.has(x.card.name) || x.card.legalities?.[f] === "legal");
  const fmt = commander ? "commander" : LIST_FORMATS.find(legalIn) || "legacy";
  const entries = spells.map(x => entry(x.card, x.count, quality(x.card)));
  const nonland = entries.filter(e => e.category !== "land");
  const score = nonland.reduce((a, e) => a + e.score * e.count, 0) / Math.max(nonland.reduce((a, e) => a + e.count, 0), 1);
  const identity = [...COLORS].filter(c => (commander ? commander.color_identity || [] : list.flatMap(x => x.card.color_identity || [])).includes(c));
  return summarize(entries, fmt, {
    ...(commander ? { commander: entry(commander, 1, quality(commander), "commander") } : {}),
    identity, themes: commander ? commanderThemes(commander) : [], score: r3(score), warnings: [], wish: null,
  });
}

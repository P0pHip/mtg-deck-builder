// Édition manuelle / par l'IA d'un deck : chaque ajout est validé (possédé, légal, couleurs, maximum).
import { BASICS, BASIC_NAMES, COLORS, basicEntry, inIdentity, pips, quality } from "./cards.js";
import { entry, summarize } from "./builder.js";

export const legalPool = (collection, deck) =>
  collection.filter(c => c.legalities?.[deck.format] === "legal" && inIdentity(c, deck.identity) && !BASIC_NAMES.has(c.name));

const BASIC_FR_IN = { plaine: "Plains", "île": "Island", marais: "Swamp", montagne: "Mountain", "forêt": "Forest" };

/** Raison précise d'un refus d'ajout : pas trouvée, illégale dans le format ou hors des couleurs. */
function whyNot(wanted, collection, deck) {
  const w = wanted.toLowerCase();
  const c = collection.find(x => x.name.toLowerCase() === w || (x.fr?.name || "").toLowerCase() === w);
  if (!c) return { ok: false, k: "notAvailable", name: wanted };
  if (c.legalities?.[deck.format] !== "legal") return { ok: false, k: "illegal", name: c.name, fmt: deck.format };
  if (!inIdentity(c, deck.identity)) {
    const missing = (c.color_identity || []).filter(x => !deck.identity.includes(x));
    return { ok: false, k: "offColor", name: c.name, colors: c.color_identity || [], missing };
  }
  return { ok: false, k: "notAvailable", name: wanted };
}

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
    const n = Math.min(singleton ? 1 : Math.max(1, parseInt(r.count ?? cards.get(name).count, 10)), cards.get(name).count);
    cards.get(name).count -= n;
    if (cards.get(name).count <= 0) cards.delete(name);
    log.push({ ok: true, sign: "−", n, name });
  }

  for (const a of add) {
    const wanted = String(a.name || "").trim();
    const basic = [...BASIC_NAMES].find(b => b.toLowerCase() === wanted.toLowerCase()) || BASIC_FR_IN[wanted.toLowerCase()];
    if (basic) {
      const col = Object.keys(BASICS).find(k => BASICS[k] === basic);
      if (col && !deck.identity.includes(col)) { log.push({ ok: false, k: "offColor", name: basic, colors: [col], missing: [col] }); continue; }
      const n = Math.max(1, parseInt(a.count ?? 1, 10));
      if (cards.has(basic)) cards.get(basic).count += n; else cards.set(basic, basicEntry(basic, n));
      log.push({ ok: true, sign: "+", n, name: basic }); continue;
    }
    const c = byName.get(wanted.toLowerCase());
    if (!c) { log.push(whyNot(wanted, collection, deck)); continue; }
    const have = cards.get(c.name)?.count || 0;
    const cap = singleton ? 1 : Math.min(c.quantity, 4);
    const n = Math.min(singleton ? 1 : Math.max(1, parseInt(a.count ?? 1, 10)), cap - have);
    if (n <= 0) { log.push({ ok: false, k: "atMax", name: c.name }); continue; }
    if (cards.has(c.name)) cards.get(c.name).count += n; else cards.set(c.name, entry(c, n, quality(c)));
    log.push({ ok: true, sign: "+", n, name: c.name, input: wanted });
  }

  const extra = { ...deck };
  for (const k of ["cards", "total", "curve", "avg_cmc", "categories", "value_eur", "format", "types", "to_buy", "buy_cost"]) delete extra[k];
  return { deck: summarize([...cards.values()], deck.format, extra), log };
}

/**
 * Échanges proposés par l'IA : on ne retire jamais plus de cartes qu'on n'a pu en ajouter.
 * 1) on teste les ajouts ; 2) on ne garde que autant de retraits (en exemplaires) que d'ajouts réussis ;
 * 3) on applique le tout. Les retraits sans remplaçante sont signalés (k: "noReplacement").
 */
export function applySwaps(deck, collection, remove = [], add = [], { protect = () => false, extraColors = [] } = {}) {
  if (extraColors.length) {
    const res = applySwaps(widenColors(deck, extraColors), collection, remove, add, { protect });
    return res.log.some(l => l.ok) ? { deck: rebalanceBasics(res.deck), log: [{ ok: true, k: "colorsAdded", colors: extraColors }, ...res.log] } : { deck, log: res.log };
  }
  const blocked = remove.filter(r => protect(r.name)).map(r => ({ ok: false, k: "protected", name: r.name }));
  remove = remove.filter(r => !protect(r.name));
  const singleton = deck.format === "commander";
  // exemplaires réellement présents dans le deck (l'IA demande parfois d'en retirer plus qu'il n'y en a)
  const inDeck = name => {
    const w = String(name || "").trim().toLowerCase();
    const w2 = (BASIC_FR_IN[w] || w).toLowerCase();
    return deck.cards.find(c => c.name.toLowerCase() === w2 || (c.fr?.name || "").toLowerCase() === w2)?.count || 0;
  };
  const removable = remove.reduce((a, r) => a + Math.min(singleton ? 1 : Math.max(1, parseInt(r.count ?? 1, 10)), inDeck(r.name)), 0);
  // s'il y a des retraits, on n'ajoute pas plus d'exemplaires qu'on ne peut en retirer (le deck garde sa taille)
  if (remove.length && removable > 0) {
    let room = removable;
    add = add.map(a => { const n = Math.min(Math.max(1, parseInt(a.count ?? 1, 10)), room); room -= n; return { ...a, count: n }; }).filter(a => a.count > 0);
  }
  const trial = applyChanges(deck, collection, [], add);
  const added = trial.log.filter(l => l.ok).reduce((a, l) => a + l.n, 0);
  const keptRemove = [], skipped = [];
  let budget = added;
  for (const r of remove) {
    const have = inDeck(r.name);
    if (!have) { skipped.push({ ok: false, k: "notInDeck", name: r.name }); continue; }
    const want = Math.min(singleton ? 1 : Math.max(1, parseInt(r.count ?? 1, 10)), have);
    const n = Math.min(want, budget);
    if (n > 0) { keptRemove.push({ ...r, count: n }); budget -= n; }
    if (n < want) skipped.push({ ok: false, k: "noReplacement", name: r.name });
  }
  if (!added) return { deck, log: [...trial.log, ...blocked, ...skipped] }; // aucun ajout possible : on ne touche à rien
  const res = applyChanges(deck, collection, keptRemove, add);
  return { deck: res.deck, log: [...res.log, ...blocked, ...skipped] };
}

/** Élargit les couleurs d'un deck à 60 cartes (le Commander garde l'identité de son commandant). */
export function widenColors(deck, extra) {
  if (deck.format === "commander") return deck;
  return { ...deck, identity: [...COLORS].filter(c => deck.identity.includes(c) || extra.includes(c)) };
}

/** Répartit à nouveau les terrains de base selon les symboles de mana du deck (même nombre total). */
export function rebalanceBasics(deck) {
  const isBasic = c => BASIC_NAMES.has(c.name);
  const n = deck.cards.filter(isBasic).reduce((a, c) => a + c.count, 0);
  if (!n) return deck;
  const rest = deck.cards.filter(c => !isBasic(c));
  const ids = [...COLORS].filter(c => deck.identity.includes(c));
  if (!ids.length) return deck;
  const p = pips(rest);
  const w = Object.fromEntries(ids.map(c => [c, p[c] + 1])); // +1 : chaque couleur garde un peu de terrains
  const tot = ids.reduce((a, c) => a + w[c], 0);
  const exact = Object.fromEntries(ids.map(c => [c, w[c] / tot * n]));
  const res = Object.fromEntries(ids.map(c => [c, Math.floor(exact[c])]));
  let left = n - ids.reduce((a, c) => a + res[c], 0);
  for (const c of [...ids].sort((a, b) => (exact[b] - res[b]) - (exact[a] - res[a]))) if (left-- > 0) res[c]++;
  const basics = ids.filter(c => res[c]).map(c => basicEntry(BASICS[c], res[c]));
  const extra = { ...deck };
  for (const k of ["cards", "total", "curve", "avg_cmc", "categories", "value_eur", "format", "types", "to_buy", "buy_cost"]) delete extra[k];
  return summarize([...rest, ...basics], deck.format, extra);
}

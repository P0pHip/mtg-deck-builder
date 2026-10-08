// Édition manuelle / par l'IA d'un deck : chaque ajout est validé (possédé, légal, couleurs, maximum).
import { BASICS, BASIC_NAMES, basicEntry, inIdentity, quality } from "./cards.js";
import { entry, summarize } from "./builder.js";

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

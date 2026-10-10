import { describe, expect, it } from "vitest";
import { applyChanges } from "../../src/core/editing.js";
import { upgradeSuggestions } from "../../src/core/upgrade.js";

const card = (name, rank, extra = {}) => ({
  name, edhrec_rank: rank, cmc: 2, type_line: "Sorcery", oracle_text: "", color_identity: ["G"],
  legalities: { commander: "legal" }, quantity: 1, ...extra,
});
const RAMP = { oracle_text: "Search your library for a basic land card, put it onto the battlefield." };
const DRAW = { oracle_text: "Draw two cards." };
// comme dans un deck enregistré : pas de rang EDHREC sur les lignes du deck
const entry = (c, cat, count = 1, extra = {}) => ({ name: c.name, count, category: cat, oracle_text: c.oracle_text, type_line: c.type_line, ...extra });

const weakRamp = card("Weak Ramp", 24000, RAMP), weakDraw = card("Weak Draw", 23000, DRAW), okDraw = card("Ok Draw", 3000, DRAW);
const known = [weakRamp, weakDraw, okDraw];
const deck = {
  format: "commander", identity: ["G"], commander: { name: "Cmdr", color_identity: ["G"] }, themes: [],
  cards: [entry(weakRamp, "ramp"), entry(weakDraw, "draw"), entry(okDraw, "draw"), entry(card("Wished", 24500, RAMP), "ramp", 1, { wish: true }),
    { name: "Forest", count: 30, category: "land" }],
};

describe("améliorer un deck avec sa collection", () => {
  it("remplace les plus faibles par de meilleures cartes libres du même rôle", () => {
    const pool = [
      card("Great Ramp", 10, RAMP), card("Great Draw", 20, DRAW), card("Slight Draw", 22500, DRAW),
      card("Red Card", 5, { ...DRAW, color_identity: ["R"] }),          // hors couleurs
      card("Banned", 1, { ...RAMP, legalities: { commander: "banned" } }), // illégale
      card("Ok Draw", 1, DRAW),                                          // déjà dans le deck
    ];
    const s = upgradeSuggestions(deck, pool, { known });
    expect(s.map(u => [u.out.name, u.in.name])).toEqual([["Weak Ramp", "Great Ramp"], ["Weak Draw", "Great Draw"]]);
    expect(s.every(u => u.gain >= 0.12)).toBe(true);
    // la carte du souhait (★) n'est jamais proposée au retrait ; « Slight Draw » ne vaut pas l'échange
    expect(s.some(u => u.out.name === "Wished" || u.in.name === "Slight Draw")).toBe(false);
    // les échanges proposés passent la validation du moteur
    const { log } = applyChanges(deck, pool, s.map(u => ({ name: u.out.name })), s.map(u => ({ name: u.in.name })));
    expect(log.every(l => l.ok)).toBe(true);
  });

  it("rien à proposer sans meilleure carte", () => {
    expect(upgradeSuggestions(deck, [card("Meh", 24900, RAMP)], { known })).toEqual([]);
  });

  it("ne propose pas de défaire un échange (les cartes du deck sont jugées sur leur vraie force)", () => {
    const strong = card("Strong Draw", 50, DRAW);
    const d = { ...deck, cards: [entry(strong, "draw")] };
    expect(upgradeSuggestions(d, [card("Old Draw", 15000, DRAW)], { known: [strong] })).toEqual([]);
  });
});

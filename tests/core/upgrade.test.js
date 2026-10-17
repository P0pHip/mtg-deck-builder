import { describe, expect, it } from "vitest";
import { applyChanges } from "../../src/core/editing.js";
import { budgetSuggestions, upgradeSuggestions } from "../../src/core/upgrade.js";

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

describe("améliorer un deck avec un budget d'achat", () => {
  const market = [
    card("Pricey Ramp", 5, { ...RAMP, price_eur: 30 }), card("Cheap Ramp", 50, { ...RAMP, price_eur: 2 }),
    card("Great Draw", 20, { ...DRAW, price_eur: 4 }), card("No Price", 1, { ...DRAW, price_eur: null }),
    card("Weak Draw", 1, { ...DRAW, price_eur: 1 }), // déjà possédée : pas à acheter
  ];

  it("reste dans le budget : la meilleure carte qui tient dans ce qu'il reste", () => {
    const { swaps, spent } = budgetSuggestions(deck, market, { budget: 10, known });
    expect(swaps.map(s => [s.out.name, s.in.name, s.cost])).toEqual([["Weak Ramp", "Cheap Ramp", 2], ["Weak Draw", "Great Draw", 4]]); // la rampe à 30 € ne tient pas dans 10 €
    expect(spent).toBe(6);
    expect(swaps.every(s => s.in.name !== "No Price" && s.in.name !== "Weak Draw")).toBe(true);
  });

  it("gros budget : la carte chère passe ; budget nul : rien", () => {
    expect(budgetSuggestions(deck, market, { budget: 100, known }).swaps.find(s => s.out.name === "Weak Ramp").in.name).toBe("Pricey Ramp");
    expect(budgetSuggestions(deck, market, { budget: 0, known })).toEqual({ swaps: [], spent: 0 });
  });
});
import { summarize } from "../../src/core/builder.js";
import { applyUpgrades } from "../../src/core/upgrade.js";

describe("améliorer un deck à 60 cartes avec sa réserve", () => {
  const c = (name, rank, quantity, extra = {}) => card(name, rank, { ...DRAW, color_identity: ["U"], legalities: { modern: "legal" }, quantity, ...extra });
  const weak = c("Weak", 24000, 4), good = c("Good", 10, 4), solo = c("Solo", 5, 1);
  const mk = side => ({
    ...summarize([{ ...entry(weak, "draw", 4), cmc: 2 }], "modern", { identity: ["U"], warnings: [] }),
    side: side.map(([x, n]) => ({ ...entry(x, "draw", n), cmc: 2 })),
  });

  it("une carte de la réserve proposée : échangée avec la carte retirée, qui part en réserve", () => {
    const deck = mk([[good, 2]]);
    const pool = [weak, good];
    const s = upgradeSuggestions(deck, pool, { known: pool });
    expect(s.map(u => [u.out.name, u.in.name, u.count, u.side])).toEqual([["Weak", "Good", 4, 2]]);
    const { deck: d, log } = applyUpgrades(deck, pool, s);
    expect(log.every(l => l.ok)).toBe(true);
    expect(d.cards.map(x => [x.name, x.count])).toEqual([["Good", 4]]);
    expect(d.side.map(x => [x.name, x.count])).toEqual([["Weak", 2]]); // 2 Good montés, 2 Weak descendus ; 2 Weak quittent le deck
    expect(d.total).toBe(4);
  });

  it("un échange impossible ne retire rien du deck", () => {
    const deck = mk([[solo, 1]]);
    // proposition périmée : « Solo » n'est plus dans la réserve et la collection n'en a pas d'autre
    const { deck: d, log } = applyUpgrades({ ...deck, side: [] }, [weak], [{ out: { name: "Weak" }, in: solo, count: 1, side: 1 }]);
    expect(log.some(l => !l.ok)).toBe(true);
    expect(d.cards.map(x => [x.name, x.count])).toEqual([["Weak", 4]]);
  });
});

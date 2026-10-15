import { describe, expect, it } from "vitest";
import { missingSummary, setProgress } from "../../src/core/stats.js";

describe("extensions à compléter", () => {
  const sets = new Map([["dmu", { printed: 4, type: "expansion" }], ["cmr", { printed: 10, type: "draft_innovation" }],
    ["tdmu", { printed: 2, type: "token" }], ["one", { printed: 100, type: "expansion" }]]);
  const card = (name, ...setCodes) => ({ name, quantity: setCodes.length, copies: setCodes.map(set => ({ set, qty: 1 })) });

  it("les plus proches d'être finies d'abord ; complètes à part ; jetons et extensions à peine entamées ignorés", () => {
    const col = [card("A", "dmu", "cmr"), card("B", "dmu", "cmr"), card("C", "dmu", "cmr"), card("D", "dmu"), card("T", "tdmu"), card("E", "one")];
    const r = setProgress(col, sets);
    expect(r.done).toEqual(["dmu"]);
    expect(r.todo).toEqual([{ code: "cmr", have: 3, size: 10, missing: 7, pct: 0.3 }]); // « one » : 1 carte, sous le seuil
  });

  it("bilan des manquantes : par rareté, coût, déjà possédées dans une autre extension", () => {
    const cat = [{ name: "A", rarity: "C", price_eur: 0.1 }, { name: "B", rarity: "R", price_eur: 3 }, { name: "C", rarity: "R", price_eur: null }, { name: "D", rarity: "M", price_eur: 10 }];
    const s = missingSummary(cat, { haveHere: { A: 1 }, haveAnywhere: { A: 1, D: 2 } });
    expect(s.cards.map(c => c.name)).toEqual(["B", "C", "D"]);
    expect(s).toMatchObject({ byRarity: { R: 2, M: 1 }, cost: 13, noPrice: 1, elsewhere: 1 });
  });
});
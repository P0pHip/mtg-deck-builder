import { describe, expect, it } from "vitest";
import { choose, hypergeom, landOdds, library, onCurveOdds, shuffle } from "../../src/core/hand.js";
import { collectionStats, recordValue, toCSV, tradeables } from "../../src/core/stats.js";
import { parseCollection } from "../../src/data/scryfall/importer.js";

const deck = (lands, spells) => ({ cards: [{ name: "Mountain", count: lands, category: "land" }, { name: "Bolt", count: spells, category: "removal" }] });

describe("main de départ", () => {
  it("bibliothèque, mélange et combinaisons", () => {
    const d = deck(24, 36);
    expect(library(d)).toHaveLength(60);
    const s = shuffle(library(d), () => 0.3);
    expect(s).toHaveLength(60);
    expect(s.filter(c => c.category === "land")).toHaveLength(24);
    expect(choose(60, 7)).toBe(386206920);
    expect(hypergeom(10, 10, 3, 3)).toBe(1);
  });

  it("probabilités de terrains (24 terrains sur 60 : 2 à 4 terrains ≈ 77,5 %, vérifié à part)", () => {
    const odds = landOdds(deck(24, 36));
    expect(odds.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(odds[2] + odds[3] + odds[4]).toBeCloseTo(0.77457, 4);
    expect(onCurveOdds(deck(24, 36), 1)).toBeCloseTo(1 - odds[0], 10); // au tour 1 en commençant : la main de 7
    expect(onCurveOdds(deck(60, 0), 4)).toBe(1);
    expect(onCurveOdds(deck(0, 60), 1)).toBe(0);
  });
});

describe("statistiques de la collection", () => {
  const col = [
    { name: "Sol Ring", quantity: 6, price_eur: 2, color_identity: [], type_line: "Artifact", set: "c21", reserved: [{ count: 2 }], free: 4 },
    { name: "Lightning Bolt", quantity: 2, price_eur: 1.5, color_identity: ["R"], type_line: "Instant", set: "2x2", free: 2 },
    { name: "Mountain", quantity: 20, price_eur: 0.1, color_identity: [], type_line: "Basic Land — Mountain", set: "dmu", free: 20 },
    { name: "Fire, \"Ice\"", quantity: 1, price_eur: null, color_identity: ["U", "R"], type_line: "Instant", set: "mh2", free: 1 },
  ];

  it("valeur totale et répartitions", () => {
    const s = collectionStats(col);
    expect(s).toMatchObject({ value: 17, cards: 4, copies: 29, reserved: 2, priced: 3 });
    expect(s.byColor.map(g => [g.key, g.value])).toEqual([["C", 12], ["L", 2], ["R", 3], ["M", 0]].sort((a, b) => b[1] - a[1]));
    expect(s.topCards.map(c => c.name)).toEqual(["Sol Ring", "Lightning Bolt", "Mountain"]);
  });

  it("doubles : au-delà du seuil, seulement les exemplaires libres, sans terrains de base", () => {
    expect(tradeables(col, 4).map(x => [x.card.name, x.extra, x.value])).toEqual([["Sol Ring", 2, 4]]);
    expect(tradeables(col, 1).map(x => [x.card.name, x.extra])).toEqual([["Sol Ring", 4], ["Lightning Bolt", 1]]);
  });

  it("historique : un relevé par jour, trié", () => {
    let h = recordValue([], col, "2026-10-02");
    h = recordValue(h, col.slice(0, 1), "2026-10-01");
    h = recordValue(h, col.slice(0, 2), "2026-10-02");
    expect(h.map(x => [x.date, x.value])).toEqual([["2026-10-01", 12], ["2026-10-02", 15]]);
  });

  it("export CSV relu par l'importeur de l'appli (guillemets compris)", () => {
    const csv = toCSV(col);
    expect(csv.split("\n")[0]).toBe("Count,Name,Edition,Set Name,Price EUR");
    expect(parseCollection("c.csv", csv)).toEqual([
      { name: "Sol Ring", quantity: 6, set: "c21" }, { name: "Lightning Bolt", quantity: 2, set: "2x2" },
      { name: "Mountain", quantity: 20, set: "dmu" }, { name: "Fire, \"Ice\"", quantity: 1, set: "mh2" },
    ]);
  });
});

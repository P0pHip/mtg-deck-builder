import { describe, expect, it } from "vitest";
import { autoTurn, commanderCost, goldfishStats, manaMade, newGoldfish, nextTurn, play } from "../../src/core/goldfish.js";

const land = { name: "Forest", category: "land", type_line: "Basic Land — Forest", count: 1 };
const bear = { name: "Bear", category: "creature", type_line: "Creature — Bear", cmc: 2, count: 1 };
const elf = { name: "Elf", category: "ramp", type_line: "Creature — Elf", cmc: 1, oracle_text: "{T}: Add {G}.", count: 1 };
const ring = { name: "Sol Ring", category: "ramp", type_line: "Artifact", cmc: 1, oracle_text: "{T}: Add {C}{C}.", count: 1 };
const cultivate = { name: "Rampant Growth", category: "ramp", type_line: "Sorcery", cmc: 2, oracle_text: "Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.", count: 1 };
const bolt = { name: "Bolt", category: "removal", type_line: "Instant", cmc: 1, count: 1 };

describe("test solitaire", () => {
  it("mana des permanents : Sol Ring 2, créature de mana 1, le reste 0", () => {
    expect([manaMade(ring), manaMade(elf), manaMade(bear), manaMade(land), manaMade(cultivate)]).toEqual([2, 1, 0, 0, 0]);
    expect(manaMade({ type_line: "Artifact", oracle_text: "{T}: Add one mana of any color." })).toBe(1);
  });

  it("un terrain par tour ; pas de sort sans le mana", () => {
    const deck = { cards: [{ ...land, count: 10 }, { ...bear, count: 10 }] };
    let s = newGoldfish(deck, { rand: () => 0.5 });
    expect(s.turn).toBe(1);
    expect(s.hand).toHaveLength(7); // on commence : pas de pioche au tour 1
    const L = () => s.hand.findIndex(c => c.name === "Forest"), B = () => s.hand.findIndex(c => c.name === "Bear");
    if (L() >= 0) {
      s = play(s, L()).state;
      expect(s.mana).toBe(1);
      if (L() >= 0) expect(play(s, L()).error).toBe("oneLand");
    }
    if (B() >= 0) expect(play(s, B()).error).toBe("noMana");
    s = nextTurn(s);
    expect(s.turn).toBe(2);
    expect(s.hand.length).toBeGreaterThanOrEqual(7);
  });

  it("Sol Ring sert tout de suite, la créature de mana au tour suivant, la rampe ajoute un terrain pour le tour suivant", () => {
    let s = { turn: 1, onPlay: true, library: [], hand: [land, ring, elf, cultivate], battlefield: [], commander: null, commanderCasts: 0,
      commanderTurn: null, landPlayed: false, mana: 0, manaTotal: 0, log: [{ turn: 1, plays: [], spent: 0, land: false }] };
    s = play(s, 0).state;            // Forest : 1 mana
    s = play(s, 0).state;            // Sol Ring (1) : +2 tout de suite → 2
    expect(s.mana).toBe(2);
    s = play(s, 0).state;            // Elf (1) → 1 restant, rien de plus ce tour
    expect(s.mana).toBe(1);
    expect(play(s, 0).error).toBe("noMana"); // Rampant Growth coûte 2
    s = nextTurn(s);
    expect(s.manaTotal).toBe(4);     // Forest + Sol Ring (2) + Elf
    s = play(s, s.hand.findIndex(c => c.name === "Rampant Growth")).state;
    s = nextTurn(s);
    expect(s.manaTotal).toBe(5);     // + le terrain cherché
  });

  it("le commandant : coût et taxe, lancé par le jeu automatique dès qu'il est abordable", () => {
    const deck = { commander: { name: "Cmdr", cmc: 2, type_line: "Legendary Creature" }, cards: [{ ...land, count: 40 }] };
    let s = newGoldfish(deck, { rand: () => 0 });
    expect(commanderCost(s)).toBe(2);
    s = autoTurn(s);
    expect(s.commanderTurn).toBeNull();
    s = autoTurn(nextTurn(s));
    expect(s.commanderTurn).toBe(2);
    expect(commanderCost(s)).toBe(4); // relancer coûterait 2 de plus
  });

  it("le jeu automatique lance d'abord la rampe, puis les sorts les plus chers possibles", () => {
    const deck = { cards: [{ ...land, count: 3 }, ring, bolt, bear] };
    let s = { ...newGoldfish(deck, { rand: () => 0 }), hand: [land, ring, bolt, bear] };
    s = autoTurn(s);
    expect(s.log[0].plays).toEqual(["Forest", "Sol Ring", "Bear"]); // 1 + 2 (Sol Ring) - 1 = 2 → Bear (2), pas Bolt
  });

  it("bilan sur plusieurs parties : plus de mana au fil des tours, terrains posés", () => {
    const deck = { commander: { name: "Cmdr", cmc: 3 }, cards: [{ ...land, count: 38 }, { ...bear, count: 30 }, { ...elf, count: 10 }, { ...ring, count: 1 }, { ...bolt, count: 20 }] };
    const r = goldfishStats(deck, { games: 200, turns: 5 });
    expect(r.turns).toHaveLength(5);
    expect(r.turns[4].mana).toBeGreaterThan(r.turns[0].mana);
    expect(r.turns[0].landDrop).toBeGreaterThan(0.8);
    expect(r.commander.avgTurn).toBeGreaterThanOrEqual(2);
    expect(r.commander.share).toBeGreaterThan(0.8);
  });
});

describe("test solitaire à deux commandants", () => {
  it("le partenaire se lance aussi (avec sa propre taxe)", () => {
    const deck = { commander: { name: "A", cmc: 1, type_line: "Legendary Creature" }, partner: { name: "B", cmc: 2, type_line: "Legendary Creature" },
      cards: [{ name: "Forest", category: "land", type_line: "Basic Land — Forest", count: 40 }] };
    let s = autoTurn(newGoldfish(deck, { rand: () => 0 }));   // 1 mana : A
    expect(s.log[0].plays).toEqual(["Forest", "A"]);
    s = autoTurn(nextTurn(s));                                 // 2 mana : B
    expect(s.log[1].plays).toEqual(["Forest", "B"]);
    expect([commanderCost(s), commanderCost(s, "partner")]).toEqual([3, 4]);
  });
});
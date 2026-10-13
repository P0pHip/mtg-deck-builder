import { describe, expect, it } from "vitest";
import { formatDecklist, parseCardLine, parseDecklist } from "../../src/core/decklist.js";

const names = list => list.map(c => `${c.count} ${c.name}`);

describe("ligne de carte", () => {
  it("lit les variantes courantes", () => {
    expect(parseCardLine("4 Lightning Bolt")).toEqual({ count: 4, name: "Lightning Bolt", set: "", number: "" });
    expect(parseCardLine("4x Lightning Bolt")).toMatchObject({ count: 4, name: "Lightning Bolt" });
    expect(parseCardLine("1 Sol Ring (C21) 263")).toEqual({ count: 1, name: "Sol Ring", set: "c21", number: "263" });
    expect(parseCardLine("1 Arcane Signet (CMM) 381 *F*")).toMatchObject({ name: "Arcane Signet", set: "cmm", number: "381" });
    expect(parseCardLine("1x Cultivate (cmr) 220 [Ramp] ^Have,#37d67a^")).toMatchObject({ name: "Cultivate", set: "cmr", number: "220" });
    expect(parseCardLine("1 Fire / Ice")).toMatchObject({ name: "Fire // Ice" });
    expect(parseCardLine("1 Brutal Cathar // Moonrage Brute (MID) 7")).toMatchObject({ name: "Brutal Cathar // Moonrage Brute", set: "mid", number: "7" });
    expect(parseCardLine("Sol Ring")).toMatchObject({ count: 1, name: "Sol Ring" });
    expect(parseCardLine("12")).toBeNull();
  });
});

describe("decklist", () => {
  it("format Arena : sections, nom du deck, compagnon en réserve", () => {
    const d = parseDecklist(`About
Name Mono Red Aggro

Commander
1 Krenko, Mob Boss (RVR) 112

Companion
1 Lurrus of the Dream-Den

Deck
4 Lightning Bolt (2X2) 117
20 Mountain

Sideboard
2 Abrade`);
    expect(d.name).toBe("Mono Red Aggro");
    expect(names(d.commander)).toEqual(["1 Krenko, Mob Boss"]);
    expect(names(d.main)).toEqual(["4 Lightning Bolt", "20 Mountain"]);
    expect(names(d.side)).toEqual(["1 Lurrus of the Dream-Den", "2 Abrade"]);
  });

  it("format MTGO : bloc après une ligne vide = réserve, « SB: » aussi", () => {
    const d = parseDecklist("4 Lightning Bolt\n20 Mountain\n36 Goblin Guide\n\n3 Abrade\nSB: 2 Duress");
    expect(names(d.main)).toEqual(["4 Lightning Bolt", "20 Mountain", "36 Goblin Guide"]);
    expect(names(d.side)).toEqual(["3 Abrade", "2 Duress"]);
  });

  it("export Moxfield Commander : le commandant seul à la fin", () => {
    const main = Array.from({ length: 99 }, (_, i) => `1 Card ${i}`).join("\n");
    const d = parseDecklist(`${main}\n\n1 Atraxa, Praetors' Voice`);
    expect(d.main).toHaveLength(99);
    expect(names(d.commander)).toEqual(["1 Atraxa, Praetors' Voice"]);
    expect(d.side).toEqual([]);
  });

  it("en-têtes en commentaire ou avec « : », peut-être ignorés, lignes inconnues signalées", () => {
    const d = parseDecklist("// Commander\n1 Krenko, Mob Boss\n// Mainboard\n1 Sol Ring\nSIDEBOARD:\n1 Duress\nMaybeboard\n1 Ponder\n42\n# un commentaire");
    expect(names(d.commander)).toEqual(["1 Krenko, Mob Boss"]);
    expect(names(d.main)).toEqual(["1 Sol Ring"]);
    expect(names(d.side)).toEqual(["1 Duress"]);
    expect(d.ignored).toEqual(["42"]);
  });
});

describe("export d'un deck en texte", () => {
  const deck = {
    commander: { name: "Atraxa, Praetors' Voice" },
    cards: [
      { name: "Forest", count: 30, type_line: "Basic Land — Forest", category: "land" },
      { name: "Sol Ring", count: 1, type_line: "Artifact", category: "ramp" },
      { name: "Delver of Secrets // Insectile Aberration", count: 1, type_line: "Creature — Human Wizard // Creature — Human Insect", category: "creature" },
    ],
  };

  it("Moxfield / Archidekt : sections, noms complets, terrains à la fin", () => {
    expect(formatDecklist(deck)).toBe("Commander\n1 Atraxa, Praetors' Voice\n\nDeck\n1 Delver of Secrets // Insectile Aberration\n1 Sol Ring\n30 Forest");
  });

  it("Arena : face avant seulement", () => {
    expect(formatDecklist(deck, "arena")).toContain("1 Delver of Secrets\n");
  });

  it("sans commandant : liste simple, relue à l'identique par l'import", () => {
    const text = formatDecklist({ cards: deck.cards });
    expect(text.startsWith("1 Delver")).toBe(true);
    expect(parseDecklist(text).main.map(c => c.name)).toEqual(["Delver of Secrets // Insectile Aberration", "Sol Ring", "Forest"]);
    expect(parseDecklist(formatDecklist(deck)).commander).toEqual([{ count: 1, name: "Atraxa, Praetors' Voice", set: "", number: "" }]);
  });
});
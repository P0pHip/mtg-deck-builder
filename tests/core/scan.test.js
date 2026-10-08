import { describe, expect, it } from "vitest";
import { bestNameMatch, cleanTitle, parseFooter, similarity } from "../../src/core/scan.js";

const sets = new Set(["mid", "znr", "neo", "woe", "m21", "inn"]);

describe("bas de carte (numéro, extension, langue)", () => {
  it("format 2023+ : « 0123 R / MID • FR »", () => {
    expect(parseFooter("0123 R\nMID • FR  Jane Doe", sets)).toEqual({ set: "mid", number: "123", lang: "fr" });
  });
  it("format 2020-2022 : « 123/280 C / ZNR • EN »", () => {
    expect(parseFooter("123/280 C\nZNR • EN ✒ Artist", sets)).toEqual({ set: "znr", number: "123", lang: "en" });
  });
  it("point médian mal lu et code avec chiffre", () => {
    expect(parseFooter("045/274 U\nM21 * EN", sets)).toEqual({ set: "m21", number: "45", lang: "en" });
    expect(parseFooter("0007 M NEO - FR", sets)).toEqual({ set: "neo", number: "7", lang: "fr" });
  });
  it("code inconnu ou absent : rien", () => {
    expect(parseFooter("0123 R\nXYZ • EN", sets)).toBeNull();
    expect(parseFooter("Illus. John Avon  TM & © 2011 Wizards", sets)).toBeNull();
  });
});

describe("nom lu dans le cartouche", () => {
  it("nettoie les symboles de mana et lettres isolées", () => {
    expect(cleanTitle("Snapcaster Mage 1U\n")).toBe("Snapcaster Mage");
    expect(cleanTitle("Fureteur des secrets © 0")).toBe("Fureteur des secrets");
    expect(cleanTitle("~ ° 1")).toBeNull();
  });
  it("trouve la carte malgré les fautes d'OCR, en FR comme en EN", () => {
    const cards = [{ name: "Delver of Secrets", fr: { name: "Fureteur des secrets" } }, { name: "Snapcaster Mage" }];
    expect(bestNameMatch("Snapcastor Mage", cards).card.name).toBe("Snapcaster Mage");
    expect(bestNameMatch("Fureteur des secrcts", cards).card.name).toBe("Delver of Secrets");
    expect(bestNameMatch("Lightning Bolt", cards)).toBeNull();
    expect(similarity("Fable of the Mirror-Breaker", "Fable of the Mirror-Breaker // Reflection of Kiki-Jiki")).toBe(1);
  });
});

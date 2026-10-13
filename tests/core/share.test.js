import { describe, expect, it } from "vitest";
import { formatDecklist } from "../../src/core/decklist.js";
import { decodeDeckShare, deckShareUrl, encodeDeckShare, shareCodeOf } from "../../src/core/share.js";

const deck = {
  commander: { name: "Atraxa, Praetors' Voice" },
  cards: Array.from({ length: 60 }, (_, i) => ({ name: `Card number ${i} // Back face`, count: 1, type_line: "Creature" }))
    .concat([{ name: "Forest", count: 39, type_line: "Basic Land — Forest" }]),
};

describe("deck partagé par lien", () => {
  it("aller-retour : même nom, même liste (accents compris)", async () => {
    const text = formatDecklist(deck);
    const code = await encodeDeckShare({ name: "Atraxa — infect élan", text });
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/); // utilisable tel quel dans une adresse
    expect(await decodeDeckShare(code)).toEqual({ name: "Atraxa — infect élan", text });
  });

  it("lien compact et lisible depuis l'adresse", async () => {
    const url = await deckShareUrl("https://p0phip.github.io/mtg-deck-builder/#collection", { name: "x", text: formatDecklist(deck) });
    expect(url.startsWith("https://p0phip.github.io/mtg-deck-builder/#deck=")).toBe(true);
    expect(url.length).toBeLessThan(formatDecklist(deck).length); // compressé
    const code = shareCodeOf(new URL(url).hash);
    expect((await decodeDeckShare(code)).name).toBe("x");
    expect(shareCodeOf("#collection")).toBeNull();
  });

  it("lien abîmé → null (pas d'erreur)", async () => {
    const code = await encodeDeckShare({ name: "x", text: "1 Sol Ring" });
    expect(await decodeDeckShare(code.slice(0, 5))).toBeNull();
    expect(await decodeDeckShare("%%%")).toBeNull();
  });
});

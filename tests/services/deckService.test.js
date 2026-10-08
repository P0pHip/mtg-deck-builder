// Génération de bout en bout sur le stockage local (IndexedDB simulé).
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { wipeAll } from "../../src/data/backup.js";
import { saveCollection } from "../../src/data/collectionRepo.js";
import { saveDeck } from "../../src/data/decksRepo.js";
import * as deckService from "../../src/services/deckService.js";

const col = JSON.parse(readFileSync(new URL("../fixtures/collection_random.json", import.meta.url)));

beforeEach(async () => { await wipeAll(); await saveCollection(col); });

describe("deckService.generate", () => {
  it("collection vide → erreur explicite", async () => {
    await saveCollection([]);
    await expect(deckService.generate({ format: "modern" })).rejects.toThrow("empty-collection");
  });

  it("propose d'emprunter quand un deck enregistré bloque de meilleures cartes", async () => {
    const body = { format: "modern", colors: ["R", "G"] };
    const first = (await deckService.generate(body)).deck;
    await saveDeck("Premier", first);
    const { deck, suggestion } = await deckService.generate(body);
    expect(suggestion).not.toBeNull();
    expect(suggestion.decks[0][1]).toBe("Premier");
    expect(deck.score).toBeLessThan(first.score + 1e-9);
    // en autorisant l'emprunt, on retrouve le deck d'origine et les emprunts sont listés
    const borrowed = await deckService.generate({ ...body, use_reserved: true });
    expect(borrowed.deck.cards.map(c => c.name).sort()).toEqual(first.cards.map(c => c.name).sort());
    expect(borrowed.deck.borrowed.length).toBeGreaterThan(0);
  });

  it("edit refuse une carte absente de la collection libre", async () => {
    const { deck } = await deckService.generate({ format: "modern", colors: ["R", "G"] });
    const { log } = await deckService.edit(deck, { add: [{ name: "Black Lotus" }] });
    expect(log).toEqual([{ ok: false, k: "notAvailable", name: "Black Lotus" }]);
  });
});

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

describe("cartes hors collection liées au souhait", () => {
  it("« jetons sang » va chercher sur Scryfall les cartes qui créent du Sang", async () => {
    const { setFetch } = await import("../../src/data/scryfall/client.js");
    const queries = [];
    const bloodCard = i => ({
      name: `Blood Maker ${i}`, oracle_id: `b${i}`, cmc: 2, mana_cost: "{B}{R}", type_line: "Creature — Vampire",
      oracle_text: "When this enters, create a Blood token.", color_identity: ["B", "R"], legalities: { modern: "legal" },
      edhrec_rank: 500, prices: { eur: "1.00" },
    });
    setFetch(async url => {
      const q = new URL(url).searchParams.get("q") || "";
      queries.push(q);
      const data = q.includes('o:"blood"') ? Array.from({ length: 8 }, (_, i) => bloodCard(i)) : [];
      return { ok: true, status: data.length ? 200 : 404, json: async () => ({ data, has_more: false }) };
    });
    const { deck } = await deckService.generate({ format: "modern", colors: ["B", "R"], include_external: true, wish: "jetons sang" });
    expect(queries.some(q => q.includes('o:"blood"') && q.includes("id<=BR"))).toBe(true);
    const bought = deck.to_buy.map(b => b.name);
    expect(bought.some(n => n.startsWith("Blood Maker"))).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { setFetch } from "../../src/data/scryfall/client.js";
import { setCatalog } from "../../src/data/scryfall/index.js";
import { addFromCatalog } from "../../src/services/collectionService.js";
import { getCard } from "../../src/data/collectionRepo.js";

const card = (name, rarity, n) => ({ object: "card", name, oracle_id: "o-" + name, rarity, collector_number: n, set: "tst", set_name: "Test", type_line: "Creature", color_identity: [], legalities: {} });

describe("catalogue d'une extension", () => {
  it("charge toutes les pages, garde la rareté et ajoute le FR, puis sert le cache", async () => {
    let calls = 0;
    setFetch(async url => {
      calls++;
      const q = new URL(url).searchParams.get("q") || "";
      const body = url.includes("page=2") ? { data: [card("Bravo", "rare", "2")], has_more: false, total_cards: 2 }
        : q.startsWith("e:tst game:paper") ? { data: [card("Alpha", "common", "1")], has_more: true, next_page: url + "&page=2", total_cards: 2 }
        : q.startsWith("e:tst lang:fr") ? { data: [{ ...card("Alpha", "common", "1"), lang: "fr", printed_name: "Alpha FR" }], has_more: false }
        : null;
      return body ? { ok: true, status: 200, json: async () => body } : { ok: false, status: 404, json: async () => ({}) };
    });
    const cards = await setCatalog("tst");
    expect(cards.map(c => [c.name, c.rarity, c.fr?.name || null])).toEqual([["Alpha", "C", "Alpha FR"], ["Bravo", "R", null]]);
    const before = calls;
    await setCatalog("tst");
    expect(calls).toBe(before);
    expect(await addFromCatalog(cards[1], 1)).toBe(1);
    expect(await addFromCatalog(cards[1], 2)).toBe(3);
    const saved = await getCard("Bravo");
    expect(saved).toMatchObject({ set: "tst", quantity: 3 });
    expect(saved.rarity).toBeUndefined();
  });
});

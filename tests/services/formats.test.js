import { describe, expect, it } from "vitest";
import { listDecks, saveDeck } from "../../src/data/decksRepo.js";
import { setFetch } from "../../src/data/scryfall/client.js";
import { checkDeckFormats, dismissNotice, formatNotices } from "../../src/services/formatService.js";

const legal = (standard, pioneer) => ({ standard, pioneer, modern: "legal", legacy: "legal", vintage: "legal", commander: "legal" });
const CARDS = { "Rotated Card": legal("not_legal", "legal"), "Fresh Card": legal("legal", "legal") };

describe("formats des decks (service)", () => {
  it("rotation : le deck change de format, un avis s'affiche, puis ne revient pas une fois fermé", async () => {
    let calls = 0;
    setFetch(async (url, opts) => {
      calls++;
      const ids = JSON.parse(opts.body).identifiers;
      return { ok: true, status: 200, json: async () => ({ data: ids.filter(i => CARDS[i.name]).map(i => ({ name: i.name, legalities: CARDS[i.name] })) }) };
    });
    const saved = await saveDeck("Mono R", { format: "standard", identity: ["R"], cards: [{ name: "Rotated Card", count: 4 }, { name: "Fresh Card", count: 4 }, { name: "Mountain", count: 20 }] });
    const fresh = await checkDeckFormats();
    expect(fresh).toEqual([expect.objectContaining({ deckId: saved.id, from: "standard", to: "pioneer", cards: ["Rotated Card"], banned: false })]);
    const [d] = await listDecks();
    expect([d.format, d.deck.format]).toEqual(["pioneer", "pioneer"]);
    expect(await checkDeckFormats()).toBeNull(); // déjà fait aujourd'hui
    expect(calls).toBe(1);
    await dismissNotice(fresh[0].key);
    expect(await formatNotices()).toEqual([]);
  });
});
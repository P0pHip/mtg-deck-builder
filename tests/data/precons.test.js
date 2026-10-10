import { describe, expect, it } from "vitest";
import { deckFromList } from "../../src/core/builder.js";
import { getCard } from "../../src/data/collectionRepo.js";
import { listDecks, reservations } from "../../src/data/decksRepo.js";
import { parseDeck, parseDeckList } from "../../src/data/mtgjson.js";
import { setFetch } from "../../src/data/scryfall/client.js";
import { enrich } from "../../src/data/scryfall/index.js";
import { addPrecon, loadPrecon, preconLines } from "../../src/services/preconService.js";

const sc = (id, name, extra = {}) => ({
  object: "card", id, name, oracle_id: "o-" + name, set: "tst", set_name: "Test", type_line: "Creature — Elf", cmc: 2,
  color_identity: ["G"], legalities: { commander: "legal", standard: "legal", modern: "legal" }, edhrec_rank: 1000, ...extra,
});
const SCRY = {
  c1: sc("c1", "Elf Lord", { type_line: "Legendary Creature — Elf" }),
  m1: sc("m1", "Llanowar Elves", { cmc: 1 }),
  m2: sc("m2", "Forest", { type_line: "Basic Land — Forest", cmc: 0, color_identity: [] }),
  s1: sc("s1", "Giant Growth", { type_line: "Instant", cmc: 1 }),
  d1: sc("d1", "Ulvenwald Oddity // Ulvenwald Behemoth", { type_line: "Creature — Beast // Creature — Beast Horror", card_faces: [{ name: "Ulvenwald Oddity" }, { name: "Ulvenwald Behemoth" }] }),
};
const json = body => ({ ok: true, status: 200, json: async () => body });
const mj = (id, name, count = 1) => ({ name, count, identifiers: { scryfallId: id } });

/** Faux réseau : MTGJSON (deck) + Scryfall (/cards/collection par id ou par nom, recherche FR vide). */
function fakeNetwork(seen = []) {
  setFetch(async (url, opts = {}) => {
    if (url.includes("mtgjson.com") && url.includes("/decks/")) {
      return json({ data: { name: "Elf Army", code: "TST", type: "Commander Deck", releaseDate: "2025-01-01",
        commander: [mj("c1", "Elf Lord")], mainBoard: [mj("m1", "Llanowar Elves", 1), mj("m2", "Forest", 30), mj("d1", "Ulvenwald Oddity // Ulvenwald Behemoth")],
        sideBoard: [mj("s1", "Giant Growth", 2)] } });
    }
    if (url.endsWith("/cards/collection")) {
      const ids = JSON.parse(opts.body).identifiers;
      seen.push(...ids);
      const all = Object.values(SCRY);
      return json({ data: ids.map(i => (i.id ? SCRY[i.id] : all.find(c => c.name === i.name || c.name.split(" // ")[0] === i.name))).filter(Boolean), not_found: [] });
    }
    return json({ data: [], has_more: false });
  });
}

describe("liste des decks préconstruits (MTGJSON)", () => {
  it("garde les decks papier connus, déjà sortis, les plus récents d'abord", () => {
    const list = parseDeckList({ data: [
      { fileName: "A_X", name: "Ancien", code: "X", releaseDate: "2010-01-01", type: "Theme Deck" },
      { fileName: "B_Y", name: "Récent", code: "Y", releaseDate: "2024-05-01", type: "Commander Deck" },
      { fileName: "C_Z", name: "Lair", code: "Z", releaseDate: "2024-06-01", type: "Secret Lair Drop" },
      { fileName: "D_W", name: "Futur", code: "W", releaseDate: "2099-01-01", type: "Commander Deck" },
    ] }, "2025-01-01");
    expect(list.map(d => [d.name, d.kind, d.set])).toEqual([["Récent", "commander", "y"], ["Ancien", "starter", "x"]]);
  });

  it("lit un fichier de deck (commandant, deck, réserve) par identifiant Scryfall", () => {
    const d = parseDeck({ data: { name: "D", code: "TST", commander: [mj("c1", "Elf Lord")], mainBoard: [mj("m1", "Llanowar Elves", 2), { name: "Sans id", count: 1 }], sideBoard: [] } });
    expect(d).toMatchObject({ name: "D", set: "tst", commander: [{ id: "c1", count: 1 }], main: [{ id: "m1", name: "Llanowar Elves", count: 2 }], side: [] });
  });
});

describe("cartes recto-verso", () => {
  it("l'enrichissement cherche par la face avant (Scryfall ne reconnaît pas « A // B »)", async () => {
    const seen = [];
    fakeNetwork(seen);
    const { collection, notFound } = await enrich([{ name: "Ulvenwald Oddity // Ulvenwald Behemoth", quantity: 1, set: "" }]);
    expect(seen).toContainEqual({ name: "Ulvenwald Oddity" });
    expect(notFound).toEqual([]);
    expect(collection[0].name).toBe("Ulvenwald Oddity // Ulvenwald Behemoth");
  });
});

describe("ajout d'un deck préconstruit", () => {
  it("ajoute les cartes (sans terrains de base ni réserve par défaut) et range le deck dans « Mes decks »", async () => {
    fakeNetwork();
    const p = await loadPrecon("ElfArmy_TST");
    expect(p.commander.name).toBe("Elf Lord");
    expect(preconLines(p).map(x => x.card.name)).toEqual(["Elf Lord", "Llanowar Elves", "Ulvenwald Oddity // Ulvenwald Behemoth"]);
    expect(preconLines(p, { basics: true, side: true })).toHaveLength(5);

    const r = await addPrecon(p, { saveDeck: true });
    expect(r).toMatchObject({ cards: 3, copies: 3 });
    expect((await getCard("Llanowar Elves")).quantity).toBe(1);
    expect(await getCard("Forest")).toBeUndefined();
    expect(await getCard("Giant Growth")).toBeUndefined();

    const [saved] = await listDecks();
    expect(saved.name).toBe("Elf Army");
    expect(saved.deck).toMatchObject({ format: "commander", total: 32, identity: ["G"] });
    expect(saved.deck.commander.name).toBe("Elf Lord");
    const res = await reservations();
    expect(res["Llanowar Elves"]).toEqual([{ id: saved.id, name: "Elf Army", count: 1 }]);
    expect(res.Forest).toBeUndefined(); // les terrains de base ne sont jamais réservés

    await addPrecon(p, { basics: true });
    expect((await getCard("Llanowar Elves")).quantity).toBe(2);
    expect((await getCard("Forest")).quantity).toBe(30);
  });
});

describe("deck à partir d'une liste", () => {
  it("sans commandant : le format le plus restreint où tout est légal", () => {
    const list = [{ card: SCRY.m1, count: 4 }, { card: { ...SCRY.s1, legalities: { modern: "legal" } }, count: 4 }, { card: SCRY.m2, count: 20 }];
    const d = deckFromList(list);
    expect(d).toMatchObject({ format: "modern", total: 28, identity: ["G"] });
    expect(d.commander).toBeUndefined();
  });
});

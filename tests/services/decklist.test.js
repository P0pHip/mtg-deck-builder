import { describe, expect, it } from "vitest";
import { getCard, setQuantity } from "../../src/data/collectionRepo.js";
import { listDecks, reservations } from "../../src/data/decksRepo.js";
import { setFetch } from "../../src/data/scryfall/client.js";
import { commanderChoices, importDecklist, saveImported, setCommander } from "../../src/services/decklistService.js";

const sc = (name, extra = {}) => ({
  object: "card", id: "id-" + name, name, oracle_id: "o-" + name, set: "tst", collector_number: "1", set_name: "Test", type_line: "Artifact", cmc: 1,
  color_identity: [], legalities: { commander: "legal", legacy: "legal" }, prices: { eur: "2.00" }, lang: "en", ...extra,
});
const CARDS = [
  sc("Krenko, Mob Boss", { type_line: "Legendary Creature — Goblin Warrior", color_identity: ["R"], set: "rvr", collector_number: "112" }),
  sc("Sol Ring", { set: "c21", collector_number: "263" }),
  sc("Goblin Guide", { type_line: "Creature — Goblin Scout", color_identity: ["R"], collector_number: "2" }),
  sc("Mountain", { type_line: "Basic Land — Mountain", cmc: 0, prices: {}, collector_number: "3" }),
  sc("Lightning Bolt", { type_line: "Instant", color_identity: ["R"], collector_number: "4" }),
];
const FR = { "Éclair": "Lightning Bolt" };
const json = body => ({ ok: true, status: 200, json: async () => body });

/** Faux Scryfall : /cards/collection (nom, nom + extension, extension + numéro), recherche floue, recherche FR. */
function fakeScryfall() {
  setFetch(async (url, opts = {}) => {
    if (url.endsWith("/cards/collection")) {
      const ids = JSON.parse(opts.body).identifiers;
      return json({ data: ids.map(i => CARDS.find(c => (i.collector_number ? c.set === i.set && c.collector_number === i.collector_number : c.name === i.name && (!i.set || c.set === i.set)))).filter(Boolean) });
    }
    const u = new URL(url);
    if (u.pathname === "/cards/named") {
      const q = u.searchParams.get("fuzzy");
      const c = CARDS.find(x => x.name.toLowerCase().replace(/[^a-z]/g, "").startsWith(q.toLowerCase().replace(/[^a-z]/g, "").slice(0, 6)));
      return c ? json(c) : { ok: false, status: 404, json: async () => ({}) };
    }
    if (u.pathname === "/cards/search") {
      const q = u.searchParams.get("q");
      const fr = Object.keys(FR).find(n => q.startsWith(n));
      if (fr && q.includes("lang:fr")) return json({ data: [{ ...CARDS.find(c => c.name === FR[fr]), lang: "fr", printed_name: fr }], has_more: false });
      return json({ data: [], has_more: false });
    }
    const m = u.pathname.match(/^\/cards\/(\w+)\/(\w+)$/);
    if (m) return json(CARDS.find(c => c.set === m[1] && c.collector_number === m[2]));
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

describe("import de decklist", () => {
  it("reconnaît les cartes (impression exacte, faute de frappe, nom français) et signale les inconnues", async () => {
    fakeScryfall();
    const imp = await importDecklist("Commander\n1 Krenko, Mob Boss (RVR) 112\n\nDeck\n1 Sol Ring (C21) 263\n2 Goblin Gide\n3 Éclair\n30 Mountain\n1 Carte Inventée\n\nSideboard\n1 Lightning Bolt");
    expect(imp.commander.name).toBe("Krenko, Mob Boss");
    expect(imp.cards.map(x => [x.board, x.count, x.card.name])).toEqual([
      ["commander", 1, "Krenko, Mob Boss"], ["main", 1, "Sol Ring"], ["main", 2, "Goblin Guide"],
      ["main", 3, "Lightning Bolt"], ["main", 30, "Mountain"], ["side", 1, "Lightning Bolt"],
    ]);
    expect(imp.notFound).toEqual(["Carte Inventée"]);
    expect(commanderChoices(imp).map(x => x.card.name)).toEqual(["Krenko, Mob Boss"]);
    setCommander(imp, null);
    expect(imp.commander).toBeNull();
    setCommander(imp, "Krenko, Mob Boss");
    expect(imp.cards[0].board).toBe("commander");
  });

  it("enregistre le deck : cartes possédées réservées, les autres à acheter ; « j'ai ce deck » complète la collection", async () => {
    fakeScryfall();
    await setQuantity("Sol Ring", 1, { ...CARDS[1], quantity: 1 });
    const imp = await importDecklist("Commander\n1 Krenko, Mob Boss\nDeck\n1 Sol Ring\n2 Goblin Guide\n30 Mountain");

    const { deck: saved } = await saveImported(imp, { name: "Krenko" });
    expect(saved.deck.format).toBe("commander");
    expect(saved.deck.to_buy.map(b => [b.name, b.count])).toEqual([["Krenko, Mob Boss", 1], ["Goblin Guide", 2]]);
    expect(saved.deck.cards.find(c => c.name === "Mountain").missing).toBeUndefined();
    expect((await reservations())["Sol Ring"]).toEqual([{ id: saved.id, name: "Krenko", count: 1 }]);

    // deuxième deck, même liste : le Sol Ring est déjà pris par « Krenko » → « j'ai ce deck » en ajoute un
    const r = await saveImported(imp, { name: "Krenko 2", complete: true });
    expect(r.added).toBe(4); // Krenko + 1 Sol Ring + 2 Goblin Guide
    expect((await getCard("Sol Ring")).quantity).toBe(2);
    expect(await getCard("Mountain")).toBeUndefined();
    expect(r.deck.deck.to_buy).toEqual([]);
    expect((await listDecks()).map(d => d.name).sort()).toEqual(["Krenko", "Krenko 2"]);
  });
});

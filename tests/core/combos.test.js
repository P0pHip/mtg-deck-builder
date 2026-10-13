import { describe, expect, it } from "vitest";
import { classifyCombos, comboUrl } from "../../src/core/combos.js";
import { setFetch } from "../../src/data/scryfall/client.js";
import { findCombos, listKey, slimVariant } from "../../src/data/spellbook.js";

const v = (id, cards, popularity = 0, legal = null) => ({ id, cards, popularity, legal, produces: [], requires: [] });
const deck = { commander: { name: "Niv-Mizzet, Parun" }, cards: [{ name: "Curiosity" }, { name: "Delver of Secrets // Insectile Aberration" }, { name: "Island" }] };

describe("combos du deck", () => {
  it("complets, presque complets (avec la carte manquante), et rien au-delà d'une carte manquante", () => {
    const r = classifyCombos([
      v("a", ["Curiosity", "Niv-Mizzet, Parun"], 100),
      v("b", ["Niv-Mizzet, Parun", "Ophidian Eye"], 50),
      v("c", ["Delver of Secrets", "Sol Ring"], 80),          // face avant reconnue
      v("d", ["Thassa's Oracle", "Demonic Consultation"], 999), // deux cartes manquantes : ignoré
    ], deck);
    expect(r.complete.map(x => x.id)).toEqual(["a"]);
    expect(r.almost.map(x => [x.id, x.missing])).toEqual([["c", "Sol Ring"], ["b", "Ophidian Eye"]]);
  });

  it("d'abord ce que ta collection permet de finir ; combos interdits dans le format écartés", () => {
    const r = classifyCombos([v("b", ["Niv-Mizzet, Parun", "Ophidian Eye"], 50), v("c", ["Curiosity", "Sol Ring"], 80, { commander: false })],
      deck, { owned: n => (n === "Ophidian Eye" ? 1 : 0), format: "commander" });
    expect(r.almost.map(x => [x.id, x.owned])).toEqual([["b", true]]);
  });

  it("lien vers la fiche du combo", () => {
    expect(comboUrl("1089-2353")).toBe("https://commanderspellbook.com/combo/1089-2353/");
  });
});

describe("Commander Spellbook", () => {
  const raw = {
    id: "1089-2353", popularity: 68535, description: "Draw a card.", easyPrerequisites: "", notablePrerequisites: "Curiosity attached to Niv-Mizzet.",
    manaNeeded: "", legalities: { commander: true }, uses: [{ card: { name: "Curiosity" } }, { card: { name: "Niv-Mizzet, Parun" } }],
    requires: [{ template: { name: "A way to draw a card" } }], produces: [{ feature: { name: "Infinite card draw" } }],
  };

  it("garde l'essentiel d'un combo", () => {
    expect(slimVariant(raw)).toEqual({
      id: "1089-2353", cards: ["Curiosity", "Niv-Mizzet, Parun"], requires: ["A way to draw a card"], produces: ["Infinite card draw"],
      description: "Draw a card.", prerequisites: "Curiosity attached to Niv-Mizzet.", mana: "", popularity: 68535, legal: { commander: true },
    });
  });

  it("empreinte indépendante de l'ordre des cartes", () => {
    expect(listKey(["b", "a"])).toBe(listKey(["a", "b"]));
    expect(listKey(["a"])).not.toBe(listKey(["b"]));
  });

  it("interroge le service (pages suivantes comprises), sans doublon, puis répond depuis le cache", async () => {
    const calls = [];
    const page = (included, almostIncluded, next = null) => ({ ok: true, status: 200, json: async () => ({ next, results: { included, almostIncluded } }) });
    setFetch(async (url, opts) => {
      calls.push([url, JSON.parse(opts.body)]);
      return calls.length === 1 ? page([raw], [], "https://backend.commanderspellbook.com/find-my-combos?offset=50") : page([], [raw, { ...raw, id: "x" }]);
    });
    const list = await findCombos({ commanders: ["Niv-Mizzet, Parun"], main: ["Curiosity"] });
    expect(list.map(x => x.id)).toEqual(["1089-2353", "x"]);
    expect(calls[0][1]).toEqual({ commanders: [{ card: "Niv-Mizzet, Parun" }], main: [{ card: "Curiosity" }] });
    expect(calls).toHaveLength(2);
    await findCombos({ commanders: ["Niv-Mizzet, Parun"], main: ["Curiosity"] });
    expect(calls).toHaveLength(2); // cache
  });
});

import { describe, expect, it } from "vitest";
import { buildCommander, edhBonus } from "../../src/core/builder.js";
import { commanderSynergies, edhrecSlug, parseCommanderPage } from "../../src/data/edhrec.js";
import { setFetch } from "../../src/data/scryfall/client.js";

const page = { container: { json_dict: { cardlists: [
  { tag: "topcards", cardviews: [{ name: "Sol Ring", synergy: 0.01, num_decks: 900, potential_decks: 1000 }] },
  { tag: "creatures", cardviews: [{ name: "Elvish Mystic", synergy: 0.4, num_decks: 600, potential_decks: 1000 },
    { name: "Sol Ring", synergy: 0.01, num_decks: 800, potential_decks: 1000 }, { name: "Broken", num_decks: 3 }] },
] } } };

describe("EDHREC", () => {
  it("identifiant de page d'un commandant", () => {
    expect(edhrecSlug("Atraxa, Praetors' Voice")).toBe("atraxa-praetors-voice");
    expect(edhrecSlug("Éowyn, Fearless Knight")).toBe("eowyn-fearless-knight");
    expect(edhrecSlug("Brutal Cathar // Moonrage Brute")).toBe("brutal-cathar");
    expect(edhrecSlug("Krenko, Tin Street Kingpin")).toBe("krenko-tin-street-kingpin");
  });

  it("lit les listes (inclusion = decks qui la jouent / decks possibles), sans doublon", () => {
    expect(parseCommanderPage(page)).toEqual([
      ["Sol Ring", { synergy: 0.01, inclusion: 0.9 }], ["Elvish Mystic", { synergy: 0.4, inclusion: 0.6 }],
    ]);
  });

  it("garde la page en cache ; injoignable ou inconnu → null (l'appli fait sans)", async () => {
    let calls = 0;
    setFetch(async url => {
      calls++;
      if (url.endsWith("/elf-lord.json")) return { ok: true, status: 200, json: async () => page };
      return { ok: false, status: 403, json: async () => ({}) };
    });
    const m = await commanderSynergies("Elf Lord");
    expect(m.get("elvish mystic")).toEqual({ synergy: 0.4, inclusion: 0.6 });
    await commanderSynergies("Elf Lord");
    expect(calls).toBe(1);
    expect(await commanderSynergies("Nobody Knows Me")).toBeNull();
    // commandant inconnu (403) : mémorisé, pas redemandé à chaque génération
    const before = calls;
    expect(await commanderSynergies("Nobody Knows Me")).toBeNull();
    expect(calls).toBe(before);
  });

  it("le bonus fait préférer les cartes jouées avec ce commandant ; sans données, rien ne change", () => {
    const edh = new Map([["elvish mystic", { synergy: 0.4, inclusion: 0.6 }]]);
    expect(edhBonus({ name: "Elvish Mystic" }, edh)).toBeCloseTo(0.68, 5);
    expect(edhBonus({ name: "Elvish Mystic" }, null)).toBe(0);

    const card = (name, rank, extra = {}) => ({ name, edhrec_rank: rank, cmc: 1, quantity: 1, type_line: "Creature — Elf", oracle_text: "",
      color_identity: ["G"], legalities: { commander: "legal" }, ...extra });
    const cmd = card("Elf Lord", 100, { type_line: "Legendary Creature — Elf" });
    // 64 sorts candidats pour 63 places : la carte la moins bien classée est écartée… sauf si EDHREC la recommande
    const pool = [cmd, card("Elvish Mystic", 24000), ...Array.from({ length: 63 }, (_, i) => card(`Filler ${i}`, 20000 + i))];
    const plain = buildCommander(pool, "Elf Lord");
    const withEdh = buildCommander(pool, "Elf Lord", null, { edh });
    expect(plain.cards.some(c => c.name === "Elvish Mystic")).toBe(false);
    expect(withEdh.cards.find(c => c.name === "Elvish Mystic")).toMatchObject({ edh: 60 });
    expect(withEdh.edhrec).toBe(true);
    expect(plain.edhrec).toBeUndefined();
  });
});

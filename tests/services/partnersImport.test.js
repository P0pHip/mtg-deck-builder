import { describe, expect, it } from "vitest";
import { setFetch } from "../../src/data/scryfall/client.js";
import { importDecklist, partnerChoices, setCommander, setPartner } from "../../src/services/decklistService.js";

const legal = { legalities: { commander: "legal" } };
const CARDS = {
  "Tymna the Weaver": { type_line: "Legendary Creature — Human Cleric", oracle_text: "Lifelink\nPartner (You can have two commanders if both have partner.)", keywords: ["Partner"], color_identity: ["W", "B"] },
  "Kraum, Ludevic's Opus": { type_line: "Legendary Creature — Zombie Horror", oracle_text: "Flying, haste\nPartner (You can have two commanders if both have partner.)", keywords: ["Partner"], color_identity: ["U", "R"] },
  "Atraxa, Praetors' Voice": { type_line: "Legendary Creature — Phyrexian Angel Horror", oracle_text: "Flying", color_identity: ["W", "U", "B", "G"] },
  "Sol Ring": { type_line: "Artifact", oracle_text: "{T}: Add {C}{C}.", color_identity: [] },
};

function fakeScryfall() {
  setFetch(async (url, opts) => {
    const ids = JSON.parse(opts?.body || "{}").identifiers || [];
    const data = ids.filter(i => CARDS[i.name]).map(i => ({ name: i.name, set: "cmr", collector_number: "1", ...legal, ...CARDS[i.name] }));
    return { ok: true, status: 200, json: async () => (url.includes("/cards/collection") ? { data } : { object: "error" }) };
  });
}

describe("decklist à deux commandants", () => {
  it("les deux commandants de la section « Commander » sont reconnus", async () => {
    fakeScryfall();
    const imp = await importDecklist("Commander\n1 Tymna the Weaver\n1 Kraum, Ludevic's Opus\n\nDeck\n1 Sol Ring\n1 Atraxa, Praetors' Voice");
    expect([imp.commander.name, imp.partner.name]).toEqual(["Tymna the Weaver", "Kraum, Ludevic's Opus"]);
    expect(imp.cards.filter(x => x.board === "commander")).toHaveLength(2);
  });

  it("changer de commandant efface le partenaire ; on ne propose que les partenaires compatibles", async () => {
    fakeScryfall();
    const imp = await importDecklist("Commander\n1 Tymna the Weaver\n\nDeck\n1 Kraum, Ludevic's Opus\n1 Sol Ring\n1 Atraxa, Praetors' Voice");
    expect(imp.partner).toBeNull();
    expect(partnerChoices(imp).map(x => x.card.name)).toEqual(["Kraum, Ludevic's Opus"]);
    setPartner(imp, "Kraum, Ludevic's Opus");
    expect(imp.partner.name).toBe("Kraum, Ludevic's Opus");
    setCommander(imp, "Atraxa, Praetors' Voice");
    expect(imp.partner).toBeNull();
    expect(imp.cards.filter(x => x.board === "commander").map(x => x.card.name)).toEqual(["Atraxa, Praetors' Voice"]);
    setPartner(imp, "Kraum, Ludevic's Opus"); // Atraxa n'a pas de partenaire
    expect(imp.partner).toBeNull();
  });
});

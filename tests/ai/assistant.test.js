// L'assistant avec un moteur simulé : les échanges proposés passent toujours par la validation du core.
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/ai/engine.js", () => ({
  generate: vi.fn(async (_model, _messages, { onToken }) => {
    const out = 'Remplace Lightning Bolt par Shock.\n```json\n{"remove":[{"name":"Foudre","count":1}],"add":[{"name":"Choc","count":1}]}\n```';
    onToken?.(out);
    return out;
  }),
}));

const { chat } = await import("../../src/ai/assistant.js");
const { applyChanges } = await import("../../src/core/editing.js");

const shock = { name: "Shock", quantity: 2, type_line: "Instant", oracle_text: "Shock deals 2 damage to any target.", color_identity: ["R"], cmc: 1, mana_cost: "{R}", legalities: { modern: "legal" }, fr: { name: "Choc" } };
const deck = {
  format: "modern", identity: ["R"], avg_cmc: 1, curve: {}, types: {},
  cards: [{ name: "Lightning Bolt", count: 4, category: "removal", cmc: 1, mana_cost: "{R}", type_line: "Instant", fr: { name: "Foudre" } }],
};

describe("assistant.chat", () => {
  it("renvoie un texte localisé et des changements que le core sait appliquer", async () => {
    const { text, changes } = await chat({ id: "m" }, deck, [shock], [{ role: "user", content: "plus de burn" }], "fr");
    expect(text).toBe("Remplace Foudre par Choc.");
    const { deck: nd, log } = applyChanges(deck, [shock], changes.remove, changes.add);
    expect(log.every(l => l.ok)).toBe(true);
    expect(nd.cards.map(c => [c.name, c.count])).toEqual(expect.arrayContaining([["Lightning Bolt", 3], ["Shock", 1]]));
  });
});

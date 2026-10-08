import { describe, expect, it } from "vitest";
import { chatMessages, explainMessages, localize, parseChanges, stripThinking } from "../../src/ai/prompts.js";

const deck = {
  format: "modern", identity: ["R"], avg_cmc: 1.5, curve: { 0: 0, 1: 4, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 }, types: { Instant: 4, Land: 20 },
  cards: [
    { name: "Lightning Bolt", count: 4, category: "removal", cmc: 1, fr: { name: "Foudre" } },
    { name: "Mountain", count: 20, category: "land", cmc: 0 },
  ],
};
const bench = [{ name: "Shock", type_line: "Instant", cmc: 1, fr: { name: "Choc" } }];

describe("prompts", () => {
  it("utilise les noms français en FR et anglais en EN", () => {
    const fr = explainMessages(deck, bench, "fr")[1].content;
    expect(fr).toContain("4x Foudre"); expect(fr).toContain("20x Montagne"); expect(fr).toContain("Choc");
    const en = explainMessages(deck, bench, "en")[1].content;
    expect(en).toContain("4x Lightning Bolt"); expect(en).not.toContain("Foudre");
  });
  it("le chat exclut du « disponible » les cartes déjà dans le deck et garde un historique court", () => {
    const history = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: String(i) }));
    const msgs = chatMessages(deck, [...bench, { name: "Lightning Bolt", type_line: "Instant", cmc: 1 }], history, "en");
    expect(msgs).toHaveLength(9);
    const available = msgs[0].content.split("AVAILABLE:")[1];
    expect(available).toContain("Shock"); expect(available).not.toContain("Lightning Bolt");
  });
});

describe("lecture des réponses", () => {
  it("extrait le bloc JSON d'échanges et le retire du texte", () => {
    const r = parseChanges('Je remplace.\n```json\n{"remove":[{"name":"Foudre","count":1}],"add":[{"name":"Choc","count":1}]}\n```');
    expect(r.text).toBe("Je remplace.");
    expect(r.changes).toEqual({ remove: [{ name: "Foudre", count: 1 }], add: [{ name: "Choc", count: 1 }] });
  });
  it("accepte un JSON nu en fin de réponse, ignore un JSON invalide", () => {
    expect(parseChanges('Ok {"add":[{"name":"Choc"}]}').changes).toEqual({ remove: [], add: [{ name: "Choc" }] });
    expect(parseChanges("```json\n{oops}\n```").changes).toBe(null);
  });
  it("retire le raisonnement interne", () => {
    expect(stripThinking("<think>hmm</think>Réponse")).toBe("Réponse");
  });
  it("localise les noms de cartes dans les deux sens, sans casser les mots", () => {
    const cards = [deck.cards[0], deck.cards[1], bench[0]];
    expect(localize("Play Lightning Bolt and a Mountain, then Shock.", cards, "fr")).toBe("Play Foudre and a Montagne, then Choc.");
    expect(localize("Joue Foudre puis Choc.", cards, "en")).toBe("Joue Lightning Bolt puis Shock.");
    expect(localize("Shockwave", cards, "fr")).toBe("Shockwave");
  });
});

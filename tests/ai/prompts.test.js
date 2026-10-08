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

describe("contexte du chat", () => {
  it("montre le texte des cartes pertinentes et signale celles hors couleurs", () => {
    const harvester = { name: "Bloodtithe Harvester", type_line: "Creature — Vampire", cmc: 2, color_identity: ["B", "R"], oracle_text: "create a Blood token." };
    const relevantShock = { ...bench[0], oracle_text: "Shock deals 2 damage to any target.", color_identity: ["R"] };
    const sys = chatMessages(deck, bench, [], "en", { relevant: [relevantShock], outOfColor: [harvester] })[0].content;
    expect(sys).toMatch(/RELEVANT[^\n]*\n- Shock \(Instant, 1, R\) : Shock deals 2 damage/);
    expect(sys).toContain("OFF-COLOR R (addable only if the player adds their color)");
    expect(sys).toContain("Bloodtithe Harvester");
    expect(sys).toContain("the deck is R");
  });
});

describe("budget de contexte", () => {
  it("réduit le contexte jusqu'à tenir dans la limite du modèle", async () => {
    const { fitChatMessages, estimateTokens } = await import("../../src/ai/prompts.js");
    const many = Array.from({ length: 80 }, (_, i) => ({ name: `Card ${i}`, type_line: "Instant", cmc: 1, color_identity: ["R"], oracle_text: "x".repeat(200) }));
    const history = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "blabla ".repeat(200) }));
    const build = limits => chatMessages(deck, many, history, "fr", { relevant: many, mentioned: [{ ...many[0], owned: 0 }], limits });
    expect(estimateTokens(build(undefined))).toBeGreaterThan(3000);
    const fitted = fitChatMessages(build, 2900);
    expect(estimateTokens(fitted)).toBeLessThanOrEqual(2900);
    expect(fitted.at(-1)).toEqual(history.at(-1)); // le dernier message du joueur est intact
  });
  it("indique si une carte mentionnée est déjà dans le deck", () => {
    const sys = chatMessages(deck, [], [], "fr", { mentioned: [{ name: "Lightning Bolt", type_line: "Instant", cmc: 1, color_identity: ["R"], legalities: { modern: "legal" }, owned: 4, fr: { name: "Foudre" } }] })[0].content;
    expect(sys).toContain("DÉJÀ DANS LE DECK");
  });
});

describe("emballement du modèle", () => {
  it("détecte un bloc JSON démesuré ou des lignes répétées", async () => {
    const { isRunaway, visibleText, parseChanges } = await import("../../src/ai/prompts.js");
    const big = "Voici.\n```json\n{\"remove\":[" + Array.from({ length: 30 }, (_, i) => `{"name":"C${i}","count":1}`).join(",");
    expect(isRunaway(big)).toBe(true);
    expect(visibleText(big)).toBe("Voici.");
    expect(isRunaway("Ligne répétée encore et encore\n".repeat(5))).toBe(true);
    expect(isRunaway('Ok\n```json\n{"remove":[{"name":"A"}],"add":[{"name":"B"}]}\n```')).toBe(false);
    const tooMany = "```json\n{\"remove\":[" + Array.from({ length: 8 }, (_, i) => `{"name":"C${i}"}`).join(",") + "],\"add\":[]}\n```";
    expect(parseChanges(tooMany).changes).toBe(null);
  });
});

describe("localize — cas limite", () => {
  it("ne double pas un nom quand la traduction contient l'original", () => {
    const cards = [{ name: "Ragavan", fr: { name: "Ragavan, chapardeur" } }];
    expect(localize("Joue Ragavan, chapardeur.", cards, "fr")).toBe("Joue Ragavan, chapardeur.");
  });
});

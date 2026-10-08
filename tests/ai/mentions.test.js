import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/ai/engine.js", () => ({ generate: vi.fn() }));
const { candidateName, looksLike, mentionedInCollection } = await import("../../src/ai/assistant.js");
const { applySwaps } = await import("../../src/core/editing.js");
const { chatMessages } = await import("../../src/ai/prompts.js");

const olivia = {
  name: "Olivia, Crimson Bride", fr: { name: "Olivia, mariée écarlate", text: "Vol, célérité…" }, mana_cost: "{4}{B}{R}",
  type_line: "Legendary Creature — Vampire Noble", oracle_text: "Flying, haste. Whenever Olivia attacks…", cmc: 6,
  color_identity: ["B", "R"], legalities: { modern: "legal" }, price_eur: 2.5,
};

describe("cartes citées dans un message", () => {
  it("extrait un nom probable d'une question", () => {
    expect(candidateName("olivia mariée ecarlate est elle un bon choix")).toBe("olivia mariee ecarlate");
    expect(candidateName('que penses-tu de "Sorin, Vengeful Bloodlord" ?')).toBe("Sorin, Vengeful Bloodlord");
  });
  it("vérifie que la carte trouvée ressemble au nom tapé (FR ou EN)", () => {
    expect(looksLike("olivia mariee ecarlate", olivia)).toBe(true);
    expect(looksLike("interessente", olivia)).toBe(false);
  });
  it("repère les cartes de la collection citées par leur nom FR ou EN", () => {
    const col = [{ name: "Lightning Bolt", fr: { name: "Foudre" } }, { name: "Opt", fr: { name: "Option" } }];
    expect(mentionedInCollection("je mets foudre ou pas ?", col).map(c => c.name)).toEqual(["Lightning Bolt"]);
  });
});

describe("échanges avec carte mentionnée et protection du souhait", () => {
  const deck = {
    format: "modern", identity: ["B", "R"], wish: { text: "sang", matched: ["sang"], fit: 0.2 },
    cards: [
      { name: "Blood Fountain", count: 2, cmc: 1, mana_cost: "{B}", type_line: "Artifact", category: "draw", wish: true },
      { name: "Shock", count: 2, cmc: 1, mana_cost: "{R}", type_line: "Instant", category: "removal" },
    ],
  };
  const pool = [{ ...olivia, quantity: 4, owned_qty: 0, external: true }];
  it("une carte ★ (souhait) n'est pas retirée par l'IA", () => {
    const r = applySwaps(deck, pool, [{ name: "Blood Fountain", count: 1 }], [{ name: "Olivia, mariée écarlate", count: 1 }], { protect: n => n === "Blood Fountain" });
    expect(r.log.some(l => l.k === "protected")).toBe(true);
    expect(r.deck.cards.find(c => c.name === "Blood Fountain").count).toBe(2);
  });
  it("une carte mentionnée non possédée est ajoutée « à acheter »", () => {
    const r = applySwaps(deck, pool, [{ name: "Shock", count: 1 }], [{ name: "Olivia, mariée écarlate", count: 1 }]);
    const o = r.deck.cards.find(c => c.name === "Olivia, Crimson Bride");
    expect(o).toMatchObject({ count: 1, owned: 0, missing: 1 });
    expect(r.deck.to_buy.map(b => b.name)).toContain("Olivia, Crimson Bride");
  });
  it("le prompt décrit la carte mentionnée avec son statut", () => {
    const sys = chatMessages(deck, [], [], "fr", { mentioned: [{ ...olivia, owned: 0 }] })[0].content;
    expect(sys).toContain("CARTES MENTIONNÉES");
    expect(sys).toMatch(/Olivia, mariée écarlate .*pas dans ma collection \(à acheter\).*dans les couleurs du deck.*légale en modern/);
    expect(sys).toContain("Blood Fountain (pioche, 1) ★");
  });
});

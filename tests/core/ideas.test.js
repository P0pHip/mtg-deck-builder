// « 💡 Que puis-je construire ? » : classement des commandants (Commander) et des couleurs (60 cartes).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as core from "../../src/core/index.js";

const col = JSON.parse(readFileSync(new URL("../fixtures/collection_random.json", import.meta.url)));

describe("idées de decks", () => {
  it("Commander : le premier du classement est le « meilleur commandant » habituel", () => {
    const ranked = core.rankCommanders(col);
    expect(ranked.length).toBe(core.commanders(col).length);
    expect(ranked[0].deck.commander.name).toBe(core.bestCommander(col).commander.name);
    expect(ranked.every((r, i) => i === 0 || ranked[i - 1].value >= r.value)).toBe(true);
  });

  it("60 cartes : chaque couleur et paire de couleurs, un deck complet devant un deck à moitié vide", () => {
    const ranked = core.rankColors(col, "modern");
    expect(ranked).toHaveLength(15); // 5 couleurs + 10 paires
    expect(ranked.every(r => r.deck.format === "modern" && r.deck.identity.length <= 2)).toBe(true);
    expect(ranked.every((r, i) => i === 0 || ranked[i - 1].value >= r.value)).toBe(true);
    const best = ranked[0], worst = ranked.at(-1);
    expect(best.missing).toBeLessThanOrEqual(worst.missing);
  });
});

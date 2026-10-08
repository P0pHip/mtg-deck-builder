// Le moteur JS doit produire exactement les mêmes decks que la version Python historique.
// Les fichiers de référence ont été générés avec builder.py sur une collection aléatoire de 260 cartes.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as core from "../../src/core/index.js";

const fixture = name => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)));
const col = fixture("collection_random.json");
const py = fixture("python_reference.json");
const key = d => d.cards.map(c => `${c.count}x${c.name}`).sort();
const wish = core.wishProfile("deck elfes agressif avec des jetons");

const cases = {
  cmd_auto: () => core.bestCommander(col),
  cmd_wish: () => core.bestCommander(col, wish),
  sixty: () => core.buildSixty(col, "modern"),
  sixty_w: () => core.buildSixty(col, "modern", null, wish),
  ext: () => core.buildSixty(
    core.mergeExternal(col.filter(c => c.legalities.modern === "legal"), col.slice(0, 60).map(c => ({ ...c, name: "X" + c.name, quantity: 0 })), 4),
    "modern", ["R", "G"]),
  edit: () => {
    const d = core.buildSixty(col, "modern");
    return core.applyChanges(d, col, [{ name: d.cards[0].name, count: 1 }], [{ name: "Forest", count: 2 }]).deck;
  },
};

describe("parité avec la version Python", () => {
  for (const [name, run] of Object.entries(cases)) {
    it(name, () => {
      const js = run(), ref = py[name];
      expect(key(js)).toEqual(key(ref));
      expect(js.identity).toEqual(ref.identity);
      expect(js.score).toBeCloseTo(ref.score, 3);
      expect(js.total).toBe(ref.total);
      expect(js.buy_cost).toBeCloseTo(ref.buy_cost, 2);
      if (ref.commander) expect(js.commander.name).toBe(ref.commander.name);
    });
  }
});

describe("règles de construction", () => {
  it("Commander : 99 cartes + commandant, singleton hors terrains de base", () => {
    const d = core.bestCommander(col);
    expect(d.total).toBe(99);
    for (const c of d.cards) if (!core.BASIC_NAMES.has(c.name)) expect(c.count).toBe(1);
    for (const c of d.cards) expect(c.name).not.toBe(d.commander.name);
  });

  it("60 cartes : 4 exemplaires max, 24 terrains, cartes légales et dans les couleurs", () => {
    const d = core.buildSixty(col, "modern", ["R", "G"]);
    expect(d.total).toBe(60);
    expect(d.categories.land).toBe(24);
    const byName = Object.fromEntries(col.map(c => [c.name, c]));
    for (const c of d.cards) {
      if (core.BASIC_NAMES.has(c.name)) continue;
      expect(c.count).toBeLessThanOrEqual(4);
      expect(byName[c.name].legalities.modern).toBe("legal");
      expect(byName[c.name].color_identity.every(x => ["R", "G"].includes(x))).toBe(true);
    }
  });

  it("cartes hors collection : possédé / manquant / liste d'achats", () => {
    const owned = [{ ...col.find(c => c.legalities.modern === "legal" && c.type_line === "Instant"), quantity: 2 }];
    const ext = [{ ...owned[0], quantity: 0 }];
    const d = core.buildSixty(core.mergeExternal(owned, ext, 4), "modern", owned[0].color_identity.length ? owned[0].color_identity : ["R"]);
    const card = d.cards.find(c => c.name === owned[0].name);
    expect(card.count).toBe(4);
    expect(card.owned).toBe(2);
    expect(card.missing).toBe(2);
    expect(d.to_buy[0]).toMatchObject({ name: owned[0].name, count: 2, owned: 2 });
  });
});

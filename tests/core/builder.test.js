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

describe("échanges proposés par l'IA (applySwaps)", () => {
  const shock = { name: "Shock", quantity: 4, type_line: "Instant", oracle_text: "", color_identity: ["R"], cmc: 1, mana_cost: "{R}", legalities: { modern: "legal" }, fr: { name: "Choc" } };
  const deck = core.summarize([
    { name: "Elf", count: 4, cmc: 1, mana_cost: "{G}", type_line: "Creature", category: "creature" },
    { name: "Mountain", count: 20, cmc: 0, mana_cost: "", type_line: "Basic Land", category: "land" },
  ], "modern", { identity: ["R"] });

  it("aucun ajout valide → le deck ne bouge pas", () => {
    const r = core.applySwaps(deck, [shock], [{ name: "Elf", count: 4 }], [{ name: "Homicide", count: 1 }]);
    expect(r.deck).toBe(deck);
    expect(r.log.map(l => l.k)).toEqual(["notAvailable", "noReplacement"]);
  });
  it("on ne retire pas plus d'exemplaires qu'on n'en ajoute", () => {
    const r = core.applySwaps(deck, [shock], [{ name: "Elf", count: 4 }], [{ name: "Choc", count: 2 }]);
    expect(r.deck.total).toBe(deck.total);
    expect(r.deck.cards.find(c => c.name === "Elf").count).toBe(2);
    expect(r.deck.cards.find(c => c.name === "Shock").count).toBe(2);
  });
});

describe("raison précise d'un refus", () => {
  const deck = core.summarize([{ name: "Mountain", count: 20, cmc: 0, mana_cost: "", type_line: "Basic Land", category: "land" }], "modern", { identity: ["B", "R"] });
  const boromir = { name: "Boromir, Warden of the Tower", fr: { name: "Boromir, gardien de la Tour" }, quantity: 4, owned_qty: 0, type_line: "Legendary Creature — Human Soldier", oracle_text: "", color_identity: ["W"], cmc: 3, mana_cost: "{2}{W}", legalities: { modern: "legal", pauper: "not_legal" } };
  it("hors des couleurs du deck (avec la couleur qui manque)", () => {
    const { log } = core.applyChanges(deck, [boromir], [], [{ name: "Boromir, gardien de la Tour" }]);
    expect(log[0]).toMatchObject({ ok: false, k: "offColor", missing: ["W"] });
  });
  it("illégale dans le format", () => {
    const { log } = core.applyChanges({ ...deck, format: "pauper" }, [boromir], [], [{ name: "Boromir, Warden of the Tower" }]);
    expect(log[0]).toMatchObject({ ok: false, k: "illegal", fmt: "pauper" });
  });
  it("ajouter la couleur : l'échange passe et les terrains de base sont rééquilibrés", () => {
    const d = core.summarize([
      { name: "Mountain", count: 10, cmc: 0, mana_cost: "", type_line: "Basic Land", category: "land" },
      { name: "Swamp", count: 10, cmc: 0, mana_cost: "", type_line: "Basic Land", category: "land" },
      { name: "Shock", count: 4, cmc: 1, mana_cost: "{R}", type_line: "Instant", category: "removal" },
    ], "modern", { identity: ["B", "R"] });
    const { deck: out, log } = core.applySwaps(d, [boromir], [{ name: "Shock", count: 2 }], [{ name: "Boromir, Warden of the Tower", count: 2 }], { extraColors: ["W"] });
    expect(log[0]).toMatchObject({ ok: true, k: "colorsAdded", colors: ["W"] });
    expect(out.identity).toEqual(["W", "B", "R"]);
    expect(out.total).toBe(24);
    const basics = Object.fromEntries(out.cards.filter(c => c.type_line === "Basic Land").map(c => [c.name, c.count]));
    expect(basics.Plains).toBeGreaterThan(0);
    expect(Object.values(basics).reduce((a, b) => a + b, 0)).toBe(20);
  });
  it("retirer 2 exemplaires d'une carte présente en 1 seul : le deck garde sa taille", () => {
    const d = core.summarize([
      { name: "Mountain", count: 20, cmc: 0, mana_cost: "", type_line: "Basic Land", category: "land" },
      { name: "Korvold", count: 1, cmc: 5, mana_cost: "{2}{B}{R}{G}", type_line: "Creature", category: "creature" },
    ], "modern", { identity: ["B", "R"] });
    const { deck: out } = core.applySwaps(d, [boromir], [{ name: "Korvold", count: 2 }], [{ name: "Boromir, Warden of the Tower", count: 2 }], { extraColors: ["W"] });
    expect(out.total).toBe(21);
  });
  it("Commander : l'identité du commandant ne change pas", () => {
    const d = { ...deck, format: "commander" };
    const { deck: out, log } = core.applySwaps(d, [{ ...boromir, legalities: { commander: "legal" } }], [], [{ name: "Boromir, Warden of the Tower" }], { extraColors: ["W"] });
    expect(out).toBe(d);
    expect(log[0]).toMatchObject({ k: "offColor" });
  });
});

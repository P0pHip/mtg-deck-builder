import { describe, expect, it } from "vitest";
import { buildSixty, wishBonus, wishProfile } from "../../src/core/index.js";

const harvester = { name: "Bloodtithe Harvester", oracle_text: "When Bloodtithe Harvester enters the battlefield, create a Blood token.", type_line: "Creature — Vampire", cmc: 2, color_identity: ["B", "R"] };
const artist = { name: "Blood Artist", oracle_text: "Whenever Blood Artist or another creature dies, target player loses 1 life and you gain 1 life.", type_line: "Creature — Vampire", cmc: 2, color_identity: ["B"] };
const elves = { name: "Llanowar Elves", oracle_text: "{T}: Add {G}.", type_line: "Creature — Elf Druid", cmc: 1, color_identity: ["G"] };

describe("souhaits en texte libre", () => {
  it("« jetons sang » : le mot libre est traduit et cherché dans le texte des cartes", () => {
    const p = wishProfile('deck sur les jetons "sang"');
    expect(p.terms.map(t => t.label)).toEqual(["sang"]);
    expect(wishBonus(harvester, p)).toBeGreaterThan(0.9);
    expect(wishBonus(elves, p)).toBe(0);
  });
  it("le nom de la carte ne compte pas (Blood Artist ne crée pas de jetons Sang)", () => {
    expect(wishBonus(artist, wishProfile("sang"))).toBe(0);
  });
  it("cherche aussi dans le texte français", () => {
    const fr = { ...elves, oracle_text: "", fr: { name: "Elfes de Llanowar", text: "Créez un jeton Trésor." } };
    expect(wishBonus(fr, wishProfile("trésors"))).toBeGreaterThan(0);
  });
  it("les mots déjà compris (thèmes, tribus, style) et les mots vides ne deviennent pas des termes", () => {
    expect(wishProfile("deck elfes agressif avec des jetons").terms).toEqual([]);
  });
  it("le souhait oriente le choix automatique des couleurs", () => {
    const leg = { modern: "legal" };
    const col = [
      ...Array.from({ length: 12 }, (_, i) => ({ ...elves, name: `Elf ${i}`, quantity: 4, legalities: leg, mana_cost: "{G}", edhrec_rank: 100 })),
      ...Array.from({ length: 6 }, (_, i) => ({ ...harvester, name: `Blood ${i}`, oracle_text: "Create a Blood token.", quantity: 4, legalities: leg, mana_cost: "{B}{R}", edhrec_rank: 9000 })),
    ];
    expect(buildSixty(col, "modern").identity).toEqual(["G"]);
    expect(buildSixty(col, "modern", null, wishProfile("jetons sang")).identity).toEqual(["B", "R"]);
  });
});

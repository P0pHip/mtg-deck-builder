import { describe, expect, it } from "vitest";
import { summarize } from "../../src/core/builder.js";
import { applyChanges } from "../../src/core/editing.js";
import { editSide, moveToMain, moveToSide, sidePool, sideRole, sideTotal, suggestSideboard } from "../../src/core/sideboard.js";

const card = (name, quantity, oracle = "", extra = {}) => ({
  name, quantity, oracle_text: oracle, type_line: "Instant", cmc: 2, color_identity: ["U"], edhrec_rank: 1000,
  legalities: { modern: "legal" }, ...extra,
});
const pool = [
  card("Counterspell", 4, "Counter target spell."),
  card("Disenchant", 4, "Destroy target artifact or enchantment.", { color_identity: ["W"] }),
  card("Relic", 3, "Exile target player's graveyard.", { type_line: "Artifact", color_identity: [] }),
  card("Bolt", 4, "Bolt deals 3 damage to any target.", { color_identity: ["R"] }),
  card("Opt", 4, "Scry 1. Draw a card."),
  card("Banned", 4, "Counter target spell.", { legalities: { modern: "banned" } }),
];
const deck = () => summarize([{ name: "Opt", count: 4, cmc: 1, category: "draw", type_line: "Instant" }], "modern", { identity: ["U"], warnings: [] });

describe("réserve (sideboard)", () => {
  it("ajouts validés : libres, légales, 4 au total avec le deck, 15 au plus", () => {
    let { deck: d, log } = editSide(deck(), pool, { add: [{ name: "Counterspell", count: 3 }, { name: "Opt", count: 1 }, { name: "Banned" }] });
    expect(d.side.map(c => [c.name, c.count])).toEqual([["Counterspell", 3]]);
    expect(log.map(l => l.ok)).toEqual([true, false, false]); // Opt : déjà 4 dans le deck ; Banned : illégale
    expect(sidePool(d, pool).find(c => c.name === "Counterspell").free).toBe(1);
    ({ deck: d } = editSide(d, pool, { remove: [{ name: "Counterspell", count: 1 }] }));
    expect(sideTotal(d)).toBe(2);
    // le deck ne peut pas dépasser 4 avec la réserve
    expect(applyChanges(d, pool, [], [{ name: "Counterspell", count: 4 }]).deck.cards.find(c => c.name === "Counterspell").count).toBe(2);
  });

  it("15 cartes au plus", () => {
    const big = Array.from({ length: 6 }, (_, i) => card(`C${i}`, 4, "Counter target spell."));
    const { deck: d, log } = editSide(deck(), big, { add: big.map(c => ({ name: c.name, count: 3 })) });
    expect(sideTotal(d)).toBe(15);
    expect(log.at(-1)).toMatchObject({ ok: false, k: "sideFull" });
  });

  it("passer une carte du deck à la réserve et inversement", () => {
    let d = moveToSide(deck(), pool, "Opt", 2).deck;
    expect([d.cards.find(c => c.name === "Opt").count, d.side[0].count, d.total]).toEqual([2, 2, 2]);
    d = moveToMain(d, pool, "Opt", 1).deck;
    expect([d.cards.find(c => c.name === "Opt").count, d.side[0].count]).toEqual([3, 1]);
  });

  it("réserve proposée : réponses variées, dans les couleurs du deck (incolores comprises)", () => {
    expect(sideRole(pool[0]).k).toBe("counter");
    expect(sideRole(pool[2]).k).toBe("graveyard");
    const d = suggestSideboard(deck(), pool);
    expect(d.side.map(c => c.name).sort()).toEqual(["Counterspell", "Relic"]); // Disenchant (blanc) et Bolt (rouge) hors couleurs
    expect(sideTotal(d)).toBe(6);
  });
});

import { deckFromList } from "../../src/core/builder.js";
import { formatDecklist, parseDecklist } from "../../src/core/decklist.js";

describe("réserve : export et import", () => {
  it("section « Sideboard » à l'export, relue par l'import", () => {
    const d = editSide(deck(), pool, { add: [{ name: "Counterspell", count: 2 }] }).deck;
    const text = formatDecklist(d);
    expect(text).toBe("Deck\n4 Opt\n\nSideboard\n2 Counterspell");
    expect(parseDecklist(text).side).toEqual([{ count: 2, name: "Counterspell", set: "", number: "" }]);
  });

  it("decklist importée avec sa réserve : ce qui manque (après le deck) passe « à acheter »", () => {
    const c = pool[0];
    const d = deckFromList([{ card: c, count: 3 }], { format: "modern", owned: { Counterspell: 4 }, side: [{ card: c, count: 2 }] });
    expect(d.side[0]).toMatchObject({ name: "Counterspell", count: 2, owned: 1, missing: 1 });
    expect(d.to_buy).toEqual([expect.objectContaining({ name: "Counterspell", count: 1 })]);
  });
});
describe("réserve : cartes contre les cimetières", () => {
  const role = oracle => sideRole({ oracle_text: oracle, type_line: "Artifact" })?.k ?? null;
  it("vraies cartes anti-cimetière reconnues, pas celles qui exilent de ton propre cimetière", () => {
    expect(role("{1}, Exile Tormod's Crypt: Exile all cards from target player's graveyard.")).toBe("graveyard");
    expect(role("{T}: Target player exiles a card from their graveyard.\n{2}, Exile Relic: Exile all graveyards. Draw a card.")).toBe("graveyard");
    expect(role("If a card or token would be put into a graveyard from anywhere, exile it instead.")).toBe("graveyard");
    expect(role("Exile target card from a graveyard. If it was a creature card, put a +1/+1 counter on Scavenging Ooze.")).toBe("graveyard");
    // Snapcaster Mage, Murktide Regent : rien contre l'adversaire
    expect(role("Flash\nWhen Snapcaster Mage enters, target instant or sorcery card in your graveyard gains flashback until end of turn. (You may cast that card from your graveyard for its flashback cost. Then exile it.)")).toBeNull();
    expect(role("Delve (Each card you exile from your graveyard while casting this spell pays for {1}.)\nFlying")).toBeNull();
  });
});
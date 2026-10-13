import { describe, expect, it } from "vitest";
import { parseDecklist } from "../../src/core/decklist.js";
import { decodeDeckShare, shareCodeOf, tradeCodeOf, tradeShareUrl } from "../../src/core/share.js";
import { sortTradeOffer, tradeText } from "../../src/core/stats.js";
import { setFetch } from "../../src/data/scryfall/client.js";
import { readTradeOffer } from "../../src/services/statsService.js";

const ring = { name: "Sol Ring", set: "c21", price_eur: 2 }, bolt = { name: "Lightning Bolt", set: "2x2", price_eur: 1.5 };
const opt = { name: "Opt", set: "", price_eur: 0.1 };

describe("classeur d'échange partagé", () => {
  it("texte des doubles, relu comme une decklist (extension comprise)", () => {
    const text = tradeText([{ card: ring, extra: 2 }, { card: opt, extra: 1 }]);
    expect(text).toBe("2 Sol Ring (C21)\n1 Opt");
    expect(parseDecklist(text).main).toEqual([{ count: 2, name: "Sol Ring", set: "c21", number: "" }, { count: 1, name: "Opt", set: "", number: "" }]);
  });

  it("lien #trade= distinct d'un lien de deck", async () => {
    const url = await tradeShareUrl("https://x.io/app/#collection", { name: "Paul", text: "2 Sol Ring (C21)" });
    const hash = new URL(url).hash;
    expect(shareCodeOf(hash)).toBeNull();
    expect(await decodeDeckShare(tradeCodeOf(hash))).toEqual({ name: "Paul", text: "2 Sol Ring (C21)" });
  });

  it("trié pour celui qui le reçoit : ce qu'il cherche, ce qu'il n'a pas, ce qu'il a", () => {
    const items = [{ card: opt, count: 1 }, { card: ring, count: 2 }, { card: bolt, count: 4 }];
    const g = sortTradeOffer(items, { wishes: [{ name: "Lightning Bolt" }], owned: { Opt: 3 } });
    expect([g.wanted, g.missing, g.owned].map(l => l.map(it => it.card.name))).toEqual([["Lightning Bolt"], ["Sol Ring"], ["Opt"]]);
  });

  it("lecture d'un classeur reçu : cartes retrouvées sur Scryfall, les autres signalées", async () => {
    setFetch(async (url, opts) => {
      const ids = JSON.parse(opts?.body || "{}").identifiers || [];
      const data = ids.filter(i => i.name === "Sol Ring").map(() => ({ name: "Sol Ring", set: "c21", collector_number: "263", prices: { eur: "2.00" } }));
      return { ok: true, status: 200, json: async () => (url.includes("/cards/collection") ? { data } : { object: "error" }) };
    });
    const r = await readTradeOffer("2 Sol Ring (C21)\n1 Zzzz Unknown Card");
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ count: 2, card: { name: "Sol Ring", price_eur: 2 } });
    expect(r.notFound).toEqual(["Zzzz Unknown Card"]);
  });
});

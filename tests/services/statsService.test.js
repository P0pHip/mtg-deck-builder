import { describe, expect, it } from "vitest";
import { getCard, saveCollection } from "../../src/data/collectionRepo.js";
import { setFetch } from "../../src/data/scryfall/client.js";
import { pricesUpdatedAt, recordToday, refreshPrices, valueHistory } from "../../src/services/statsService.js";

describe("statistiques : prix et historique", () => {
  it("met à jour les prix (extension d'abord, puis nom seul ; foil si l'impression n'existe qu'en foil) et note la valeur du jour", async () => {
    await saveCollection([
      { name: "Sol Ring", quantity: 2, set: "c21", price_eur: 1 },
      { name: "Brutal Cathar // Moonrage Brute", quantity: 1, set: "xxx", price_eur: 3 },
      { name: "Atraxa, Praetors' Voice", quantity: 1, set: "c16", price_eur: 21 },
      { name: "Obscure Promo", quantity: 1, set: "pxx", price_eur: 5 },
    ]);
    setFetch(async (url, opts) => {
      const ids = JSON.parse(opts.body).identifiers;
      const data = ids.map(i => (i.name === "Sol Ring" && i.set === "c21" ? { name: "Sol Ring", set: "c21", prices: { eur: "1.50" } }
        : i.name === "Brutal Cathar" && !i.set ? { name: "Brutal Cathar // Moonrage Brute", set: "mid", prices: { eur: "3" } }
        : i.name === "Atraxa, Praetors' Voice" && i.set === "c16" ? { name: i.name, set: "c16", finishes: ["foil"], prices: { eur: null, eur_foil: "40.00" } }
        : i.name === "Obscure Promo" ? { name: i.name, set: "pxx", finishes: ["nonfoil", "foil"], prices: { eur: null, eur_foil: "9" } } : null)).filter(Boolean);
      return { ok: true, status: 200, json: async () => ({ data }) };
    });
    const r = await refreshPrices();
    expect(r).toEqual({ updated: 3, changed: 2 });
    expect((await getCard("Sol Ring")).price_eur).toBe(1.5);
    expect((await getCard("Atraxa, Praetors' Voice")).price_eur).toBe(40);
    expect((await getCard("Obscure Promo")).price_eur).toBe(5); // sans prix normal : l'ancien prix reste
    expect(await pricesUpdatedAt()).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await recordToday([{ name: "Sol Ring", quantity: 2, price_eur: 1.5 }]);
    const h = await valueHistory();
    expect(h).toHaveLength(1);
    expect(h[0].value).toBe(3);
  });
});

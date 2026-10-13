import { describe, expect, it } from "vitest";
import { addWishes, dropOwned, priceAlerts, setWishCount, setWishTarget, stillMissing, wishTotal, withWishPrices } from "../../src/core/wishlist.js";
import { setFetch } from "../../src/data/scryfall/client.js";
import { exportBackup, importBackup, wipeAll } from "../../src/data/backup.js";
import * as wishlistService from "../../src/services/wishlistService.js";

const bolt = { name: "Lightning Bolt", set: "2x2", price_eur: 1.5, image_small: "s.jpg", legalities: { modern: "legal" } };
const ring = { name: "Sol Ring", set: "c21", price_eur: 2 };

describe("liste d'envies (règles)", () => {
  it("ajout sans doublon : on garde le plus grand nombre voulu et toutes les sources", () => {
    let l = addWishes([], [{ card: bolt, count: 4 }], { source: "Burn", date: "2026-10-10" });
    l = addWishes(l, [{ card: bolt, count: 2 }, { card: ring }], { source: "Krenko" });
    expect(l.map(w => [w.name, w.count, w.sources])).toEqual([["Lightning Bolt", 4, ["Burn", "Krenko"]], ["Sol Ring", 1, ["Krenko"]]]);
    expect(l[0].legalities).toBeUndefined(); // seules les données d'affichage sont gardées
    expect(setWishCount(l, "Sol Ring", 0).map(w => w.name)).toEqual(["Lightning Bolt"]);
  });

  it("ce qui manque encore, total et retrait de ce qu'on possède", () => {
    const l = addWishes([], [{ card: bolt, count: 4 }, { card: ring, count: 1 }]);
    const owned = { "Lightning Bolt": 1, "Sol Ring": 3 };
    expect(stillMissing(l[0], owned)).toBe(3);
    expect(wishTotal(l, owned)).toBe(4.5);
    expect(dropOwned(l, owned)).toMatchObject({ removed: 1, list: [{ name: "Lightning Bolt" }] });
  });
});

describe("liste d'envies (stockage)", () => {
  it("est enregistrée, sauvegardée, restaurée et effacée avec le reste", async () => {
    await wishlistService.addWishes([{ card: bolt, count: 2 }], "Burn");
    const backup = await exportBackup();
    expect(backup.wishlist.map(w => w.name)).toEqual(["Lightning Bolt"]);
    await wipeAll();
    expect(await wishlistService.wishlist()).toEqual([]);
    await importBackup({ ...backup, collection: [{ name: "Lightning Bolt", quantity: 2 }] });
    expect((await wishlistService.wishlist())[0]).toMatchObject({ name: "Lightning Bolt", count: 2 });
    expect(await wishlistService.removeOwned([{ name: "Lightning Bolt", quantity: 2 }])).toBe(1);
    expect(await wishlistService.wishlist()).toEqual([]);
  });
});

describe("prix cible et alertes", () => {
  it("alerte quand le prix passe sous la cible, sauf si la carte est déjà possédée", () => {
    let l = addWishes([], [{ card: bolt, count: 1 }, { card: ring, count: 1 }]);
    l = setWishTarget(setWishTarget(l, "Lightning Bolt", 1.2), "Sol Ring", 0); // 0 = pas d'alerte
    expect(l.map(w => w.target)).toEqual([1.2, null]);
    expect(priceAlerts(l)).toEqual([]);
    l = withWishPrices(l, { "Lightning Bolt": 0.99, "Sol Ring": 2 });
    expect(l[0]).toMatchObject({ price_eur: 0.99, price_prev: 1.5 });
    expect(l[1].price_prev).toBeUndefined(); // prix inchangé
    expect(priceAlerts(l).map(w => w.name)).toEqual(["Lightning Bolt"]);
    expect(priceAlerts(l, { "Lightning Bolt": 1 })).toEqual([]);
  });

  it("met à jour les prix une fois par jour (ou à la demande)", async () => {
    await wishlistService.clear();
    await wishlistService.addWishes([{ card: bolt, count: 1 }]);
    await wishlistService.setTarget("Lightning Bolt", 1);
    let calls = 0;
    setFetch(async () => { calls++; return { ok: true, status: 200, json: async () => ({ data: [{ name: "Lightning Bolt", set: "2x2", prices: { eur: "0.80" } }] }) }; });
    expect(await wishlistService.refreshPrices({ force: true })).toBe(true);
    expect((await wishlistService.wishlist())[0]).toMatchObject({ price_eur: 0.8, price_prev: 1.5, target: 1 });
    expect(await wishlistService.refreshPrices()).toBe(false); // déjà fait aujourd'hui
    expect(calls).toBe(1);
  });
});
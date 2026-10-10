import { describe, expect, it } from "vitest";
import { addCopies, cardValue, changeTotal, copiesOf, copyKey, qtyInSet, removeCopies, setsOf, updateCopy } from "../../src/core/copies.js";
import { exportBackup, importBackup } from "../../src/data/backup.js";
import * as repo from "../../src/data/collectionRepo.js";
import { tx } from "../../src/data/db.js";
import { setFetch } from "../../src/data/scryfall/client.js";
import { addFromCatalog, importFile, removeFromSet } from "../../src/services/collectionService.js";

const ring = { name: "Sol Ring", set: "c21", set_name: "Commander 2021", price_eur: 2 };

describe("exemplaires (règles)", () => {
  it("une ancienne carte sans détail devient un exemplaire de son extension", () => {
    expect(copiesOf({ ...ring, quantity: 3 })).toEqual([
      { set: "c21", set_name: "Commander 2021", number: "", lang: "", foil: false, condition: "NM", qty: 3, price_eur: null, price_foil: null },
    ]);
  });

  it("fusion des identiques, total, valeur foil et retrait des moins chers d'abord", () => {
    let c = addCopies({ ...ring, quantity: 2 }, [
      { set: "cmm", foil: true, qty: 1, price_eur: 3, price_foil: 12 },
      { set: "c21", qty: 1 },                       // identique au premier : fusionné
    ]);
    expect(c.quantity).toBe(4);
    expect(c.copies.map(x => [x.set, x.foil, x.qty])).toEqual([["c21", false, 3], ["cmm", true, 1]]);
    expect(cardValue(c)).toBe(3 * 2 + 12);
    expect(setsOf(c)).toEqual(["c21", "cmm"]);
    c = removeCopies(c, 3); // les 3 c21 (2 € chacun) partent avant le foil (12 €)
    expect(c.copies.map(x => [x.set, x.qty])).toEqual([["cmm", 1]]);
    c = changeTotal(c, 3);
    expect(c.copies.map(x => [x.set, x.qty])).toEqual([["cmm", 3]]);
    expect(qtyInSet(c, "cmm")).toBe(3);
  });

  it("modifier un exemplaire (langue, état, foil) peut le fusionner avec un autre", () => {
    let c = addCopies({ ...ring, quantity: 1 }, [{ set: "c21", lang: "fr", qty: 1 }]);
    const fr = c.copies.find(x => x.lang === "fr");
    c = updateCopy(c, copyKey(fr), { lang: "" });
    expect(c.copies).toHaveLength(1);
    expect(c.quantity).toBe(2);
    c = updateCopy(c, copyKey(c.copies[0]), { qty: 0 });
    expect(c.quantity).toBe(0);
  });
});

describe("exemplaires (stockage)", () => {
  it("migration à la lecture, ajout depuis le catalogue, retrait par extension", async () => {
    // ancienne donnée : pas de « copies »
    await tx("collection", "readwrite", s => { s.put({ ...ring, quantity: 2 }); });
    expect((await repo.getCard("Sol Ring")).copies).toHaveLength(1);

    expect(await addFromCatalog({ ...ring, set: "cmm", set_name: "Commander Masters", number: "410", price_eur: 3, price_foil: 8 }, 1, { foil: true })).toBe(3);
    const c = await repo.getCard("Sol Ring");
    expect(c.copies.map(x => [x.set, x.number, x.foil, x.qty])).toEqual([["c21", "", false, 2], ["cmm", "410", true, 1]]);

    expect(await removeFromSet("Sol Ring", "c21")).toBe(2);
    expect(await repo.setQuantity("Sol Ring", 5)).toBe(5); // ajout sur le premier exemplaire
    expect((await repo.getCard("Sol Ring")).copies.map(x => [x.set, x.qty])).toEqual([["c21", 4], ["cmm", 1]]);

    // sauvegarde fusionnée : les exemplaires détaillés sont gardés
    const backup = await exportBackup();
    await importBackup(backup, { merge: true });
    expect((await repo.getCard("Sol Ring")).copies.map(x => [x.set, x.foil, x.qty])).toEqual([["c21", false, 8], ["cmm", true, 2]]);
  });

  it("import CSV : plusieurs exemplaires d'une même carte → une carte avec ses exemplaires", async () => {
    setFetch(async (url, opts) => {
      if (url.endsWith("/cards/collection")) {
        const ids = JSON.parse(opts.body).identifiers;
        return { ok: true, status: 200, json: async () => ({ data: ids.filter(i => /opt/i.test(i.name)).map(() => ({
          object: "card", name: "Opt", oracle_id: "o-opt", set: "eld", set_name: "Throne of Eldraine", type_line: "Instant",
          prices: { eur: "0.10", eur_foil: "0.50" }, legalities: {}, color_identity: ["U"] })) }) };
      }
      return { ok: true, status: 200, json: async () => ({ data: [], has_more: false }) };
    });
    const csv = "Count,Name,Edition,Language,Foil,Condition\n2,Opt,ELD,French,,NM\n1,Opt,ELD,English,foil,LP\n";
    const r = await importFile("m.csv", csv);
    expect(r).toMatchObject({ cards: 1, copies: 3, notFound: [] });
    const opt = await repo.getCard("Opt");
    expect(opt.quantity).toBe(3);
    expect(opt.copies.map(x => [x.lang, x.foil, x.condition, x.qty, x.price_eur])).toEqual([["fr", false, "NM", 2, 0.1], ["en", true, "LP", 1, 0.1]]);
  });
});

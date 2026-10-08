// Stockage local : collection, decks, réservations, emprunts, sauvegarde.
import { beforeEach, describe, expect, it } from "vitest";
import * as backup from "../../src/data/backup.js";
import * as collectionRepo from "../../src/data/collectionRepo.js";
import * as decksRepo from "../../src/data/decksRepo.js";

const card = (name, quantity) => ({ name, quantity, type_line: "Instant", oracle_text: "", color_identity: ["R"], cmc: 1, legalities: { modern: "legal" } });
const deckWith = (...cards) => ({ format: "modern", identity: ["R"], cards: cards.map(([name, count, missing = 0]) => ({ name, count, missing })) });

beforeEach(async () => { await backup.wipeAll(); });

describe("collection", () => {
  it("setQuantity ajoute, modifie et supprime", async () => {
    await collectionRepo.saveCollection([card("Opt", 2)]);
    expect(await collectionRepo.setQuantity("Opt", 5)).toBe(5);
    expect(await collectionRepo.setQuantity("Bolt", 1)).toBe(null); // inconnue sans données
    expect(await collectionRepo.setQuantity("Bolt", 1, card("Bolt", 0))).toBe(1);
    expect(await collectionRepo.setQuantity("Opt", 0)).toBe(0);
    expect((await collectionRepo.loadCollection()).map(c => [c.name, c.quantity])).toEqual([["Bolt", 1]]);
  });
});

describe("decks et réservations", () => {
  it("les cartes d'un deck enregistré ne sont plus libres", async () => {
    const col = [card("Opt", 4), card("Bolt", 2)];
    await collectionRepo.saveCollection(col);
    const d = await decksRepo.saveDeck("Izzet", deckWith(["Opt", 3], ["Mountain", 20]));
    const free = await decksRepo.available(col);
    expect(free.map(c => [c.name, c.quantity])).toEqual([["Opt", 1], ["Bolt", 2]]);
    // le deck en cours d'édition ne se bloque pas lui-même
    expect((await decksRepo.available(col, d.id)).find(c => c.name === "Opt").quantity).toBe(4);
  });

  it("les exemplaires « à acheter » ne sont pas réservés", async () => {
    const d = deckWith(["Bolt", 4, 2]);
    expect(decksRepo.deckCards(d)).toEqual({ Bolt: 2 });
  });

  it("borrowReport indique quelles cartes viennent de quel deck", async () => {
    const col = [card("Opt", 2)];
    await decksRepo.saveDeck("A", deckWith(["Opt", 2]));
    const report = await decksRepo.borrowReport(deckWith(["Opt", 1]), col);
    expect(report).toEqual([{ name: "Opt", count: 1, decks: [expect.objectContaining({ name: "A", count: 2 })] }]);
  });

  it("éclater un deck libère ses cartes", async () => {
    const col = [card("Opt", 2)];
    const d = await decksRepo.saveDeck("A", deckWith(["Opt", 2]));
    expect(await decksRepo.available(col)).toEqual([]);
    await decksRepo.deleteDeck(d.id);
    expect((await decksRepo.available(col))[0].quantity).toBe(2);
  });
});

describe("sauvegarde", () => {
  it("export puis restauration à l'identique", async () => {
    await collectionRepo.saveCollection([card("Opt", 2)]);
    await decksRepo.saveDeck("A", deckWith(["Opt", 1]));
    const data = await backup.exportBackup();
    await backup.wipeAll();
    expect(await backup.importBackup(data)).toEqual({ cards: 1, decks: 1 });
    expect((await decksRepo.listDecks())[0].name).toBe("A");
  });
  it("refuse un fichier invalide", async () => {
    await expect(backup.importBackup({ foo: 1 })).rejects.toThrow();
  });
});

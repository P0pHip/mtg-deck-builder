import { describe, expect, it } from "vitest";
import { gameRecord, newGame } from "../../src/core/game.js";
import { exportBackup, importBackup, wipeAll } from "../../src/data/backup.js";
import * as gameHistoryService from "../../src/services/gameHistoryService.js";

const game = newGame([{ name: "Paul", deckId: "d1", deck: "Atraxa" }, { name: "Léa" }], { life: 40, commander: true });

describe("historique des parties", () => {
  it("enregistre, compte les victoires des decks et retire une partie", async () => {
    await gameHistoryService.record(gameRecord(game, 0, 1000));
    await gameHistoryService.record(gameRecord(game, 1, 2000));
    expect((await gameHistoryService.history()).map(r => r.at)).toEqual([2000, 1000]); // la plus récente d'abord
    expect((await gameHistoryService.deckRecords()).get("d1")).toMatchObject({ name: "Atraxa", played: 2, wins: 1 });
    await gameHistoryService.remove(2000);
    expect((await gameHistoryService.history()).map(r => r.at)).toEqual([1000]);
  });

  it("est sauvegardé, restauré (fusion sans doublon) et effacé avec le reste", async () => {
    const backup = await exportBackup();
    expect(backup.gameHistory.map(r => r.at)).toEqual([1000]);
    await gameHistoryService.record(gameRecord(game, 1, 3000));
    await importBackup(backup, { merge: true });
    expect((await gameHistoryService.history()).map(r => r.at)).toEqual([3000, 1000]);
    await wipeAll();
    expect(await gameHistoryService.history()).toEqual([]);
    await importBackup(backup);
    expect((await gameHistoryService.history()).map(r => r.at)).toEqual([1000]);
  });
});

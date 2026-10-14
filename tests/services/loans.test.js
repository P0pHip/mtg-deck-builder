import { describe, expect, it } from "vitest";
import { addLoan, borrowers, loanReservations, loansByPerson, returnLoan, withoutLoans } from "../../src/core/loans.js";
import { exportBackup, importBackup, wipeAll } from "../../src/data/backup.js";
import { saveCollection } from "../../src/data/collectionRepo.js";
import * as decksRepo from "../../src/data/decksRepo.js";
import { loadWithReservations } from "../../src/services/collectionService.js";
import * as loanService from "../../src/services/loanService.js";

describe("cartes prêtées (règles)", () => {
  it("prêter, regrouper par personne, rendre", () => {
    let l = addLoan([], { id: "a", name: "Sol Ring", count: 1, to: " Paul ", date: "2026-10-12" });
    l = addLoan(l, { id: "b", name: "Lightning Bolt", count: 2, to: "Léa", date: "2026-10-01" });
    l = addLoan(l, { id: "c", name: "Opt", count: 4, to: "paul", date: "2026-10-02" });
    expect(l[0].to).toBe("Paul");
    expect(loansByPerson(l).map(g => [g.to, g.count, g.loans.map(x => x.id)])).toEqual([["Léa", 2, ["b"]], ["Paul", 5, ["c", "a"]]]);
    expect(borrowers(l)).toEqual(["Léa", "Paul"]); // « Paul » et « paul » : la même personne
    expect(returnLoan(l, "a").map(x => x.id)).toEqual(["b", "c"]);
  });

  it("vus comme des réservations, et retirés de ce qu'on a sous la main", () => {
    const l = [{ id: "a", name: "Sol Ring", count: 1, to: "Paul" }, { id: "b", name: "Opt", count: 4, to: "Léa" }];
    expect(loanReservations(l)["Sol Ring"]).toEqual([{ id: "loan:a", name: "🤝 Paul", count: 1, loan: true }]);
    expect(withoutLoans([{ name: "Sol Ring", quantity: 2 }, { name: "Opt", quantity: 4 }], l)).toEqual([{ name: "Sol Ring", quantity: 1 }]);
  });
});

describe("cartes prêtées (appli)", () => {
  it("une carte prêtée n'est plus libre, puis le redevient une fois rendue ; sauvegardée avec le reste", async () => {
    await saveCollection([{ name: "Sol Ring", quantity: 2 }]);
    await loanService.lend("Sol Ring", 1, "Paul");
    let [ring] = await loadWithReservations();
    expect(ring).toMatchObject({ free: 1, reserved: [{ name: "🤝 Paul", count: 1, loan: true }] });
    expect(await decksRepo.notLent([{ name: "Sol Ring", quantity: 2 }])).toEqual([{ name: "Sol Ring", quantity: 1 }]);

    const backup = await exportBackup();
    expect(backup.loans).toHaveLength(1);
    await wipeAll();
    expect(await loanService.loans()).toEqual([]);
    await importBackup(backup);
    const [loan] = await loanService.loans();
    expect(loan).toMatchObject({ name: "Sol Ring", to: "Paul", count: 1 });

    await loanService.giveBack(loan.id);
    [ring] = await loadWithReservations();
    expect(ring.free).toBe(2);
    await expect(loanService.lend("Sol Ring", 1, "  ")).rejects.toThrow("no-borrower");
  });
});

describe("restauration d'une ancienne sauvegarde", () => {
  it("restauration complète : prêts et historique absents de la sauvegarde sont vidés ; fusion : gardés", async () => {
    await saveCollection([{ name: "Sol Ring", quantity: 1 }]);
    await loanService.lend("Sol Ring", 1, "Paul");
    const old = { collection: [{ name: "Opt", quantity: 2 }], decks: [] }; // sauvegarde d'avant les prêts
    await importBackup(old, { merge: true });
    expect(await loanService.loans()).toHaveLength(1);
    await importBackup(old);
    expect(await loanService.loans()).toEqual([]);
  });
});
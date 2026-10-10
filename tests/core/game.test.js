import { describe, expect, it } from "vitest";
import { changeCommanderDamage, changeLife, changePoison, lostBy, newGame, pickFirst, resetGame, rollDie } from "../../src/core/game.js";

const players = [{ name: "A" }, { name: "B" }, { name: "C" }];

describe("compteur de partie", () => {
  it("points de vie : chaque action renvoie une nouvelle partie", () => {
    const g0 = newGame(players, { life: 40, commander: true });
    const g1 = changeLife(changeLife(g0, 1, -3), 1, -10);
    expect(g0.players[1].life).toBe(40);
    expect(g1.players.map(p => p.life)).toEqual([40, 27, 40]);
    expect(g1.log.map(l => l.delta)).toEqual([-3, -10]);
  });

  it("élimination : vie à 0, 10 poisons, 21 blessures d'un même commandant", () => {
    let g = newGame(players, { life: 40, commander: true });
    expect(lostBy(g, 0)).toBeNull();
    g = changePoison(g, 0, 10);
    expect(lostBy(g, 0)).toBe("poison");
    g = changeCommanderDamage(g, 1, 2, 21);
    expect(g.players[1].life).toBe(19); // les blessures de commandant retirent aussi des points de vie
    expect(lostBy(g, 1)).toBe("commander");
    g = changeLife(g, 2, -40);
    expect(lostBy(g, 2)).toBe("life");
    // sans la règle Commander, les blessures de commandant n'éliminent pas
    const plain = changeCommanderDamage(newGame(players, { life: 40 }), 0, 1, 21);
    expect(lostBy(plain, 0)).toBeNull();
  });

  it("le poison et les blessures de commandant ne descendent pas sous 0", () => {
    let g = newGame(players, { life: 20 });
    g = changePoison(g, 0, -1);
    expect(g.players[0].poison).toBe(0);
    g = changeCommanderDamage(g, 0, 1, 3);
    g = changeCommanderDamage(g, 0, 1, -5);
    expect(g.players[0].cmd).toEqual([0, 0, 0]);
    expect(g.players[0].life).toBe(20);
  });

  it("premier joueur, dés et nouvelle partie", () => {
    const g = pickFirst(newGame(players, { life: 20 }), () => 0.7);
    expect(g.first).toBe(2);
    expect(rollDie(20, () => 0)).toBe(1);
    expect(rollDie(20, () => 0.999)).toBe(20);
    const again = resetGame(changeLife(g, 0, -5));
    expect(again.players.map(p => [p.name, p.life])).toEqual([["A", 20], ["B", 20], ["C", 20]]);
  });
});

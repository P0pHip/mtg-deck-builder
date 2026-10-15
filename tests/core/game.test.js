import { describe, expect, it } from "vitest";
import { changeCommanderDamage, changeLife, changePoison, gameRecord, historyStats, lostBy, newGame, pickFirst, resetGame, rollDie, soleSurvivor } from "../../src/core/game.js";

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

describe("fin de partie et historique", () => {
  it("vainqueur évident quand il ne reste qu'un joueur", () => {
    let g = newGame(players, { life: 20 });
    expect(soleSurvivor(g)).toBeNull();
    g = changeLife(changeLife(g, 0, -20), 2, -25);
    expect(soleSurvivor(g)).toBe(1);
  });

  it("fiche de partie : durée, decks, gagnant, éliminations", () => {
    let g = newGame([{ name: "A", deckId: "d1", deck: "Atraxa" }, { name: "B" }], { life: 40, commander: true });
    g = { ...changePoison(g, 1, 10), startedAt: 0 };
    const r = gameRecord(g, 0, 45 * 60000);
    expect(r).toMatchObject({ minutes: 45, commander: true });
    expect(r.players).toEqual([
      { name: "A", deckId: "d1", deck: "Atraxa", winner: true, out: null },
      { name: "B", deckId: null, deck: null, winner: false, out: "poison" },
    ]);
    expect(resetGame(g).players[0].deck).toBe("Atraxa"); // la revanche garde les decks
  });

  it("statistiques par deck et par joueur", () => {
    const rec = (winner, ...ps) => ({ players: ps.map(([name, deckId], i) => ({ name, deckId, deck: deckId && deckId.toUpperCase(), winner: i === winner })) });
    const h = [rec(0, ["Paul", "a"], ["Léa", "b"]), rec(1, ["paul", "a"], ["Léa", "c"]), rec(0, ["Léa", "b"], ["Paul", null]), rec(null, ["Paul", "a"], ["Léa", "b"])];
    const s = historyStats(h);
    expect(s.players).toEqual([{ key: "léa", name: "Léa", played: 4, wins: 2 }, { key: "paul", name: "Paul", played: 4, wins: 1 }]);
    expect(s.decks.map(d => [d.name, d.wins, d.played])).toEqual([["C", 1, 1], ["A", 1, 3], ["B", 1, 3]]); // à victoires égales : meilleur taux, puis nom
  });
});
import { gameInsights } from "../../src/core/game.js";

describe("statistiques de jeu poussées", () => {
  // la plus récente d'abord
  const r = (minutes, ...ps) => ({ minutes, players: ps.map(([name, deckId, winner, extra = {}]) => ({ name, deckId, deck: deckId && deckId.toUpperCase(), winner, out: winner ? null : "life", ...extra })) });
  const h = [
    r(40, ["Paul", "a", true, { first: true }], ["Léa", "b", false]),
    r(50, ["Paul", "a", true], ["Léa", "b", false, { first: true, out: "poison" }]),
    r(30, ["Paul", "a", false, { first: true }], ["Léa", "c", true]),
    r(60, ["Paul", "a", true], ["Léa", "b", false], ["Max", null, false]),
  ];
  it("durée moyenne, premier joueur, éliminations, séries en cours", () => {
    const s = gameInsights(h);
    expect(s).toMatchObject({ games: 4, avgMinutes: 45, firstPlayer: { games: 3, wins: 1 }, outs: { life: 4, poison: 1, commander: 0 } });
    expect(s.streaks).toEqual([{ name: "Paul", n: 2 }]); // Paul a gagné les 2 dernières ; Léa a perdu la dernière
  });
  it("duels entre decks", () => {
    expect(gameInsights(h).matchups).toEqual([{ a: "A", b: "B", aWins: 3, bWins: 0 }, { a: "A", b: "C", aWins: 0, bWins: 1 }]);
  });
  it("le tirage « qui commence » est gardé dans la fiche de partie", () => {
    let g = pickFirst(newGame(players), () => 0.5);
    expect(gameRecord(g, null, 1).players.findIndex(p => p.first)).toBe(g.first);
  });
});
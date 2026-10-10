// Compteur de partie (points de vie, poison, blessures de commandant). Pur : chaque action renvoie une nouvelle partie.

export const POISON_MAX = 10;
export const COMMANDER_MAX = 21;

/** Nouvelle partie. players : [{ name, deckId?, image? }] ; life : points de vie de départ. */
export function newGame(players, { life = 20, commander = false } = {}) {
  return {
    life, commander, startedAt: Date.now(), first: null, log: [],
    players: players.map(p => ({ name: p.name, deckId: p.deckId || null, image: p.image || null,
      life, poison: 0, cmd: players.map(() => 0) })), // cmd[j] : blessures reçues du commandant du joueur j
  };
}

const clone = g => ({ ...g, players: g.players.map(p => ({ ...p, cmd: [...p.cmd] })), log: [...g.log] });
const note = (g, i, kind, delta) => { g.log.push({ i, kind, delta, at: Date.now() }); if (g.log.length > 200) g.log.shift(); return g; };

/** Points de vie ± delta. */
export function changeLife(game, i, delta) {
  const g = clone(game);
  g.players[i].life += delta;
  return note(g, i, "life", delta);
}

/** Marqueurs poison ± delta (jamais négatifs). */
export function changePoison(game, i, delta) {
  const g = clone(game), p = g.players[i];
  const d = Math.max(-p.poison, delta);
  p.poison += d;
  return d ? note(g, i, "poison", d) : g;
}

/** Blessures de commandant reçues par i de la part de j ± delta : elles retirent aussi des points de vie. */
export function changeCommanderDamage(game, i, j, delta) {
  const g = clone(game), p = g.players[i];
  const d = Math.max(-p.cmd[j], delta);
  p.cmd[j] += d;
  p.life -= d;
  return d ? note(g, i, `cmd:${j}`, d) : g;
}

/** Raison de l'élimination d'un joueur ("life" | "poison" | "commander"), ou null s'il est encore en jeu. */
export function lostBy(game, i) {
  const p = game.players[i];
  if (p.life <= 0) return "life";
  if (p.poison >= POISON_MAX) return "poison";
  if (game.commander && p.cmd.some(n => n >= COMMANDER_MAX)) return "commander";
  return null;
}

/** Tire au sort le premier joueur. `rand` : générateur [0, 1) (pour les tests). */
export function pickFirst(game, rand = Math.random) {
  return { ...clone(game), first: Math.floor(rand() * game.players.length) };
}

/** Recommence la partie avec les mêmes joueurs. */
export const resetGame = game => newGame(game.players, { life: game.life, commander: game.commander });

/** Lancer de dé à `faces` faces. */
export const rollDie = (faces = 20, rand = Math.random) => 1 + Math.floor(rand() * faces);

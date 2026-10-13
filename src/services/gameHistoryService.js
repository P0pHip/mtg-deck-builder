// Cas d'usage « historique des parties » : stocké localement (IndexedDB, clé « gameHistory »), inclus dans les sauvegardes.
import { historyStats } from "../core/game.js";
import { kvGet, kvSet } from "../data/db.js";

const KEY = "gameHistory";
const MAX = 1000;

/** Parties terminées, la plus récente d'abord. */
export const history = async () => (await kvGet(KEY)) || [];

/** Enregistre une partie terminée (fiche de core/game.js → gameRecord). */
export async function record(rec) {
  await kvSet(KEY, [rec, ...(await history()).filter(r => r.at !== rec.at)].slice(0, MAX));
}

export async function remove(at) {
  await kvSet(KEY, (await history()).filter(r => r.at !== at));
}

export const clear = () => kvSet(KEY, []);

/** Statistiques { decks, players } de tout l'historique. */
export const stats = async () => historyStats(await history());

/** Bilan des decks enregistrés : Map identifiant du deck → { name, played, wins } (absent si jamais joué). */
export async function deckRecords() {
  return new Map((await stats()).decks.map(d => [d.key, d]));
}

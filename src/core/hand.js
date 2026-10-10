// Main de départ : bibliothèque mélangée, pioche, mulligan, et probabilités de terrains (loi hypergéométrique). Pur.

const isLand = c => c.category === "land";

/** Bibliothèque du deck : une entrée par exemplaire (le commandant reste dans la zone de commandement). */
export function library(deck) {
  return deck.cards.flatMap(c => Array.from({ length: c.count }, () => c));
}

/** Mélange de Fisher-Yates (nouveau tableau). `rand` : générateur [0, 1). */
export function shuffle(cards, rand = Math.random) {
  const a = [...cards];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Coefficient binomial C(n, k) (en flottants : suffisant pour un deck de 100 cartes). */
export function choose(n, k) {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 1; i <= k; i++) r = r * (n - k + i) / i;
  return r;
}

/** P(exactement k succès en tirant `draws` cartes parmi `size`, dont `hits` succès). */
export const hypergeom = (size, hits, draws, k) => choose(hits, k) * choose(size - hits, draws - k) / choose(size, draws);

/** Répartition du nombre de terrains dans la main de départ : tableau [P(0), …, P(hand)]. */
export function landOdds(deck, hand = 7) {
  const lib = library(deck), lands = lib.filter(isLand).length;
  return Array.from({ length: hand + 1 }, (_, k) => hypergeom(lib.length, lands, hand, k));
}

/**
 * Probabilité d'avoir au moins `turn` terrains au tour `turn` (pour poser un terrain par tour).
 * onPlay : on commence (pas de pioche au tour 1).
 */
export function onCurveOdds(deck, turn, { onPlay = true, hand = 7 } = {}) {
  const lib = library(deck), lands = lib.filter(isLand).length;
  const seen = Math.min(lib.length, hand + turn - (onPlay ? 1 : 0));
  let p = 0;
  for (let k = turn; k <= seen; k++) p += hypergeom(lib.length, lands, seen, k);
  return p;
}

export const landsIn = cards => cards.filter(isLand).length;

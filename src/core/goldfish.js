// Test « solitaire » (goldfish) : jouer seul les premiers tours d'un deck pour voir s'il démarre bien. Pur.
// Règles simplifiées : un terrain par tour, chaque terrain donne 1 mana (couleurs ignorées), les artefacts et
// enchantements de mana servent tout de suite, les créatures de mana au tour suivant, les sorts de rampe
// (« cherche un terrain… sur le champ de bataille ») ajoutent un terrain engagé.
import { library, shuffle } from "./hand.js";

const isLand = c => c.category === "land" || /\bLand\b/.test((c.type_line || "").split(" // ")[0]);
const isPermanent = c => !/\b(Instant|Sorcery)\b/.test((c.type_line || "").split(" // ")[0]);
const isCreature = c => /\bCreature\b/.test((c.type_line || "").split(" // ")[0]);

/** Terrain (pour compter les terrains du champ de bataille). */
export const isLandCard = isLand;

/** Mana produit par un permanent qui n'est pas un terrain (Sol Ring : 2, Elfes de Llanowar : 1), sinon 0. */
export function manaMade(c) {
  if (isLand(c) || !isPermanent(c)) return 0;
  const m = (c.oracle_text || "").match(/\{T\}[^.:]*:\s*Add ([^.]*)/i);
  if (!m) return 0;
  if (/one mana of any|mana of any one|any color/i.test(m[1])) return 1;
  return Math.min(3, Math.max(1, (m[1].match(/\{[WUBRGC]\}/g) || []).length));
}

/** Sort de rampe qui met un terrain sur le champ de bataille (Cultivate, Rampant Growth…). */
const fetchesLand = c => !isPermanent(c) && /onto the battlefield/i.test(c.oracle_text || "") && /\bland/i.test(c.oracle_text || "");

const BASIC = { name: "", category: "land", type_line: "Basic Land", pseudo: true };

/** Mana disponible au début du tour : terrains + permanents de mana (créatures arrivées avant ce tour). */
function manaAtStart(s) {
  return s.battlefield.reduce((a, p) => a + (isLand(p.card) ? 1 : isCreature(p.card) && p.turn >= s.turn ? 0 : manaMade(p.card)), 0);
}

const clone = s => ({ ...s, library: [...s.library], hand: [...s.hand], battlefield: [...s.battlefield], log: s.log.map(l => ({ ...l, plays: [...l.plays] })) });

/** Nouvelle partie : bibliothèque mélangée, main de 7, premier tour commencé. `onPlay` : on commence (pas de pioche au tour 1). */
export function newGoldfish(deck, { rand = Math.random, onPlay = true } = {}) {
  const lib = shuffle(library(deck), rand);
  return nextTurn({
    turn: 0, onPlay, library: lib.slice(7), hand: lib.slice(0, 7), battlefield: [], commander: deck.commander || null,
    commanderCasts: 0, commanderTurn: null, partner: deck.partner || null, partnerCasts: 0,
    landPlayed: false, mana: 0, manaTotal: 0, log: [],
  });
}

/** Tour suivant : pioche (sauf au tour 1 si on commence), mana de nouveau disponible. */
export function nextTurn(state) {
  const s = clone(state);
  s.turn++;
  const draws = s.turn === 1 && s.onPlay ? 0 : 1;
  const drawn = s.library.splice(0, draws);
  s.hand.push(...drawn);
  s.landPlayed = false;
  s.manaTotal = s.mana = manaAtStart(s);
  s.log.push({ turn: s.turn, drew: drawn[0] || null, plays: [], spent: 0, land: false });
  return s;
}

/** Coût du commandant, ou du partenaire (`which` = "partner") : taxe de 2 par lancement précédent. */
export const commanderCost = (s, which = "commander") => (s[which] ? (s[which].cmc || 0) + 2 * (s[`${which}Casts`] || 0) : Infinity);

function enter(s, card) {
  s.battlefield.push({ card, turn: s.turn });
  if (!isCreature(card)) { const m = manaMade(card); s.mana += m; s.manaTotal += m; } // artefact de mana : sert tout de suite
}

/**
 * Joue la carte n° `i` de la main (ou un commandant : i === "commander" ou "partner").
 * Retourne { state, error } : error = "oneLand" (déjà un terrain ce tour) ou "noMana" (pas assez de mana).
 */
export function play(state, i) {
  const s = clone(state), log = s.log[s.log.length - 1];
  if (i === "commander" || i === "partner") {
    const cost = commanderCost(s, i);
    if (cost > s.mana) return { state, error: "noMana" };
    s.mana -= cost; log.spent += cost; s[`${i}Casts`]++;
    if (i === "commander" && s.commanderTurn === null) s.commanderTurn = s.turn;
    enter(s, s[i]);
    log.plays.push(s[i].name);
    return { state: s };
  }
  const card = s.hand[i];
  if (!card) return { state, error: "noCard" };
  if (isLand(card)) {
    if (s.landPlayed) return { state, error: "oneLand" };
    s.hand.splice(i, 1);
    s.landPlayed = true; log.land = true;
    s.battlefield.push({ card, turn: s.turn });
    s.mana++; s.manaTotal++;
    log.plays.push(card.name);
    return { state: s };
  }
  const cost = card.cmc || 0;
  if (cost > s.mana) return { state, error: "noMana" };
  s.hand.splice(i, 1);
  s.mana -= cost; log.spent += cost;
  if (isPermanent(card)) enter(s, card);
  else if (fetchesLand(card)) s.battlefield.push({ card: { ...BASIC, name: `(${card.name})` }, turn: s.turn + 1 }); // terrain engagé : utile au tour suivant
  log.plays.push(card.name);
  return { state: s };
}

/**
 * Joue le tour tout seul : un terrain, puis les sorts de mana d'abord, puis le commandant s'il est abordable,
 * puis les sorts les plus chers qui rentrent dans le mana restant.
 */
export function autoTurn(state) {
  let s = state;
  const landAt = s.hand.findIndex(isLand);
  if (!s.landPlayed && landAt >= 0) s = play(s, landAt).state;
  for (;;) {
    const options = s.hand.map((c, i) => ({ c, i })).filter(o => !isLand(o.c) && (o.c.cmc || 0) <= s.mana);
    const ramp = options.filter(o => manaMade(o.c) || fetchesLand(o.c)).sort((a, b) => (a.c.cmc || 0) - (b.c.cmc || 0))[0];
    if (ramp) { s = play(s, ramp.i).state; continue; }
    if (s.commander && s.commanderCasts === 0 && commanderCost(s) <= s.mana) { s = play(s, "commander").state; continue; }
    if (s.partner && s.partnerCasts === 0 && commanderCost(s, "partner") <= s.mana) { s = play(s, "partner").state; continue; }
    const best = options.sort((a, b) => (b.c.cmc || 0) - (a.c.cmc || 0))[0];
    if (!best) return s;
    s = play(s, best.i).state;
  }
}

/**
 * Bilan de `games` parties jouées automatiquement sur `turns` tours : par tour, mana disponible et dépensé en moyenne,
 * part des parties où un terrain a été posé ; tour moyen du commandant (et part des parties où il est sorti).
 */
export function goldfishStats(deck, { games = 400, turns = 5, rand = Math.random, onPlay = true } = {}) {
  const per = Array.from({ length: turns }, (_, k) => ({ turn: k + 1, mana: 0, spent: 0, landDrop: 0 }));
  let cmdTurns = 0, cmdGames = 0;
  for (let g = 0; g < games; g++) {
    let s = newGoldfish(deck, { rand, onPlay });
    for (let k = 0; k < turns; k++) {
      if (k) s = nextTurn(s);
      s = autoTurn(s);
      const log = s.log[s.log.length - 1];
      per[k].mana += s.manaTotal; per[k].spent += log.spent; per[k].landDrop += log.land ? 1 : 0;
    }
    if (s.commanderTurn !== null) { cmdTurns += s.commanderTurn; cmdGames++; }
  }
  const r1 = x => Math.round(x * 10) / 10;
  return {
    turns: per.map(p => ({ turn: p.turn, mana: r1(p.mana / games), spent: r1(p.spent / games), landDrop: Math.round(p.landDrop / games * 100) / 100 })),
    commander: deck.commander ? { avgTurn: cmdGames ? r1(cmdTurns / cmdGames) : null, share: Math.round(cmdGames / games * 100) / 100 } : null,
  };
}

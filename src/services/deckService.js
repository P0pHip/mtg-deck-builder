// Cas d'usage « deck » : génération (avec réservations, emprunts, cartes hors collection) et édition.
import * as core from "../core/index.js";
import { loadCollection } from "../data/collectionRepo.js";
import * as decksRepo from "../data/decksRepo.js";
import { commanderSynergies } from "../data/edhrec.js";
import { frenchFor, themeCards, topCards } from "../data/scryfall/index.js";
import { findCombos } from "../data/spellbook.js";

/**
 * Paramètres de génération :
 * { format, commander, colors, wish, use_reserved, include_external }
 */
export function makeDeck(pool, body, edh = null) {
  const wish = core.wishProfile(body.wish);
  if (body.format === "commander") {
    if (body.commander) return pool.some(c => c.name === body.commander) ? core.buildCommander(pool, body.commander, wish, { edh }) : null;
    return core.bestCommander(pool, wish);
  }
  return core.buildSixty(pool, body.format, body.colors?.length ? body.colors : null, wish);
}

/**
 * Génère un deck avec les cartes libres. Si emprunter des cartes rangées dans d'autres decks
 * donnerait un deck nettement meilleur ou plus complet, renvoie aussi une `suggestion`.
 * `deckId` : deck en cours d'édition (ses propres cartes ne comptent pas comme réservées).
 */
export async function generate(body, { deckId = null, onStep = () => {} } = {}) {
  const col = await loadCollection();
  if (!col.length) throw new Error("empty-collection");
  const res = await decksRepo.reservations(deckId);
  const free = decksRepo.availableSync(col, res);
  const pool = body.use_reserved ? col : free;
  let deck = makeDeck(pool, body);

  let suggestion = null;
  if (!body.use_reserved && Object.keys(res).length) {
    const full = makeDeck(col, body);
    if (full && (!deck || full.total > deck.total || full.score > deck.score + 0.02)) {
      const borrow = await decksRepo.borrowReport(full, col, deckId);
      if (borrow.length) {
        const ids = new Map();
        borrow.forEach(b => b.decks.forEach(d => ids.set(d.id, d.name)));
        suggestion = {
          cards: borrow, decks: [...ids],
          score_gain: Math.round((full.score - (deck?.score || 0)) * 100),
          total_gain: full.total - (deck?.total || 0),
        };
      }
    }
  }
  if (!deck) return { deck: null, suggestion };

  // Commander : synergies réelles du commandant (EDHREC), si on peut les récupérer ; sinon le deck reste tel quel.
  // Appliquées après la suggestion d'emprunt, qui se calcule donc pareil avec ou sans réseau.
  let edh = null;
  if (deck.commander && body.use_edhrec !== false) {
    onStep("edhrec");
    edh = await commanderSynergies(deck.commander.name);
    if (edh) deck = makeDeck(pool, { ...body, commander: deck.commander.name }, edh) || deck;
  }

  if (body.include_external) {
    onStep("external");
    deck = await withExternal(deck, pool, body, edh);
  }
  deck.borrowed = body.use_reserved ? await decksRepo.borrowReport(deck, col, deckId) : [];
  return { deck, suggestion };
}

/** Reconstruit le deck en autorisant les cartes les plus jouées hors collection (commandant et couleurs conservés). */
async function withExternal(deck, ownedPool, body, edh = null) {
  let ext;
  try {
    // meilleures cartes du format + cartes liées aux mots libres du souhait (ex. « sang » → o:"blood")
    const terms = (core.wishProfile(body.wish)?.terms || []).map(t => t.en);
    const [top, theme] = await Promise.all([topCards(deck.format, deck.identity), themeCards(deck.format, deck.identity, terms)]);
    const seen = new Set(top.map(c => c.name));
    ext = [...top, ...theme.filter(c => !seen.has(c.name))];
  } catch (e) { deck.warnings.push({ k: "extErr", e: e.message }); return deck; }
  const cap = deck.format === "commander" ? 1 : 4;
  const fixed = { ...body, colors: deck.identity, commander: deck.commander?.name || body.commander };
  const nd = makeDeck(core.mergeExternal(ownedPool, ext, cap), fixed, edh) || deck;
  const byName = new Map(ext.map(c => [c.name, c]));
  await frenchFor(nd.cards.filter(c => c.missing && byName.has(c.name)).map(c => byName.get(c.name)));
  for (const c of nd.cards) if (!c.fr && byName.get(c.name)?.fr) c.fr = byName.get(c.name).fr;
  return nd;
}

/** Cartes utilisables pour éditer un deck (libres, ou toute la collection si les emprunts sont autorisés). */
export async function editablePool(deckId, useReserved) {
  const col = await loadCollection();
  return useReserved ? col : decksRepo.available(col, deckId);
}

/** Applique des retraits / ajouts validés. Retourne { deck, log }. */
export async function edit(deck, changes, { deckId = null, useReserved = false } = {}) {
  return core.applyChanges(deck, await editablePool(deckId, useReserved), changes.remove || [], changes.add || []);
}

/** Échanges proposés par l'IA : jamais plus de retraits que d'ajouts réussis. Retourne { deck, log }. */
export async function swap(deck, changes, { deckId = null, useReserved = false, mentioned = [], extraColors = [] } = {}) {
  const pool = await editablePool(deckId, useReserved);
  // cartes citées dans le chat mais pas possédées : ajoutables comme « à acheter »
  const cap = deck.format === "commander" ? 1 : 4;
  const owned = new Map(pool.map(c => [c.name, c]));
  for (const m of mentioned) {
    const have = owned.get(m.name);
    if (have) owned.set(m.name, { ...have, owned_qty: have.quantity, quantity: Math.max(have.quantity, cap) });
    else owned.set(m.name, { ...m, quantity: cap, owned_qty: 0, external: true });
  }
  // les cartes qui correspondent au souhait du joueur (★) ne sont pas retirées par l'IA
  const protectedNames = new Set(deck.wish ? deck.cards.filter(c => c.wish).map(c => c.name) : []);
  const isProtected = n => [...protectedNames].some(p => {
    const c = deck.cards.find(x => x.name === p);
    return p.toLowerCase() === String(n).toLowerCase() || (c?.fr?.name || "").toLowerCase() === String(n).toLowerCase();
  });
  return core.applySwaps(deck, [...owned.values()], changes.remove || [], changes.add || [], { protect: isProtected, extraColors });
}

/** Cartes encore ajoutables au deck, triées par popularité, avec le nombre d'exemplaires disponibles. */
export async function addableCards(deck, { deckId = null, useReserved = false } = {}) {
  const pool = await editablePool(deckId, useReserved);
  const inDeck = Object.fromEntries(deck.cards.map(c => [c.name, c.count]));
  const cap = deck.format === "commander" ? 1 : 4;
  return core.legalPool(pool, deck)
    .map(c => ({ ...c, free: Math.min(c.quantity, cap) - (inDeck[c.name] || 0) }))
    .filter(c => c.free > 0)
    .sort((a, b) => (a.edhrec_rank || 1e9) - (b.edhrec_rank || 1e9));
}

export const defaultDeckName = (deck, displayName) =>
  deck.commander ? displayName(deck.commander) : `${deck.format[0].toUpperCase() + deck.format.slice(1)} ${deck.identity.join("")}`;

/** Échanges proposés pour améliorer le deck avec les cartes disponibles (voir core/upgrade.js). */
export async function upgrade(deck, { deckId = null, useReserved = false, useEdhrec = true } = {}) {
  const edh = deck.commander && useEdhrec ? await commanderSynergies(deck.commander.name) : null;
  return core.upgradeSuggestions(deck, await editablePool(deckId, useReserved), { known: await loadCollection(), edh });
}

/**
 * Idées de decks avec la collection, du meilleur au moins bon. Commander : les meilleurs commandants possibles ;
 * formats à 60 cartes : les meilleures couleurs (mono ou bicolores). `wish` : souhait libre (« zombies », « tokens »).
 */
export async function ideas({ format = "commander", wish = "", useReserved = false, top = 8 } = {}) {
  const col = await loadCollection();
  const pool = useReserved ? col : decksRepo.availableSync(col, await decksRepo.reservations());
  const profile = core.wishProfile(wish);
  if (format !== "commander") {
    return core.rankColors(pool, format, profile).slice(0, top).map(({ deck, missing, value }) => {
      // illustration : la meilleure carte du deck
      const star = [...deck.cards].filter(c => c.category !== "land" && c.image_small).sort((a, b) => b.score - a.score)[0] || null;
      return { colors: deck.identity, identity: deck.identity, star, total: deck.total, missing, themes: [], power: deck.power,
        fit: profile ? deck.wish?.fit ?? 0 : null, value };
    });
  }
  // « que puis-je construire ? » : un deck presque complet passe devant un deck plus fort mais à moitié vide
  return core.rankCommanders(pool, profile).map(({ deck, value }) => {
    const missing = deck.warnings.find(w => w.k === "incomplete")?.n || 0;
    return { commander: deck.commander, identity: deck.identity, score: deck.score, power: deck.power, total: deck.total + 1, themes: deck.themes,
      missing, fit: profile ? deck.wish?.fit ?? 0 : null, value: value - missing / 99 };
  }).sort((a, b) => b.value - a.value).slice(0, top);
}

/** Combos complets ou presque du deck, d'après Commander Spellbook (réseau). Les terrains de base ne sont pas envoyés. */
export async function deckCombos(deck) {
  const main = deck.cards.map(c => c.name).filter(n => !core.BASIC_NAMES.has(n.replace(/^Snow-Covered /, "")));
  return findCombos({ commanders: deck.commander ? [deck.commander.name] : [], main });
}
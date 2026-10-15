// Cas d'usage « formats des decks » : une fois par jour, les decks enregistrés sont comparés aux légalités actuelles
// (rotation Standard, cartes bannies). Un deck qui n'est plus légal est rangé dans le format suivant où il l'est
// (Standard → Pioneer → Modern…), et un avis reste affiché dans « Mes decks » jusqu'à ce que le joueur le ferme.
import * as core from "../core/index.js";
import { kvGet, kvSet } from "../data/db.js";
import * as decksRepo from "../data/decksRepo.js";
import { legalitiesFor } from "../data/scryfall/index.js";

const AT = "formatsCheckedAt", NOTICES = "formatNotices", DISMISSED = "formatNoticesDismissed";
const DAY = 24 * 3600 * 1000;
const noticeKey = n => `${n.deckId}|${n.from}|${n.cards.join(",")}`;

/** Avis en cours : [{ key, at, deckId, deck, from, to, cards, n, banned }], le plus récent d'abord. */
export const formatNotices = async () => (await kvGet(NOTICES)) || [];

export async function dismissNotice(key) {
  await kvSet(NOTICES, (await formatNotices()).filter(n => n.key !== key));
  await kvSet(DISMISSED, [...((await kvGet(DISMISSED)) || []), key].slice(-200)); // ne revient pas le lendemain
}

/**
 * Vérifie les decks enregistrés (au plus une fois par jour, sauf `force`). Retourne les nouveaux avis ([] si rien),
 * ou null si la vérification n'a pas eu lieu (déjà faite aujourd'hui, aucun deck).
 */
export async function checkDeckFormats({ force = false } = {}) {
  const last = await kvGet(AT);
  if (!force && last && Date.now() - last < DAY) return null;
  const decks = await decksRepo.listDecks();
  if (!decks.length) return null;
  const names = [...new Set(decks.flatMap(d => [...d.deck.cards.map(c => c.name), ...core.commandZone(d.deck).map(c => c.name)]))]
    .filter(n => !core.BASIC_NAMES.has(n));
  const legal = await legalitiesFor(names);
  const dismissed = new Set((await kvGet(DISMISSED)) || []), fresh = [];
  for (const d of decks) {
    const r = core.formatCheck(d.deck, legal);
    if (!r) continue;
    // le deck change de catégorie s'il existe un format où il est légal
    if (r.newFormat) await decksRepo.saveDeck(d.name, { ...d.deck, format: r.newFormat }, d.id);
    const n = { at: Date.now(), deckId: d.id, deck: d.name, from: d.deck.format, to: r.newFormat,
      cards: r.illegal.map(x => x.name).sort(), banned: r.illegal.some(x => x.status === "banned") };
    n.key = noticeKey(n);
    if (!dismissed.has(n.key)) fresh.push(n);
  }
  const keep = (await formatNotices()).filter(o => !fresh.some(n => n.key === o.key));
  await kvSet(NOTICES, [...fresh, ...keep].slice(0, 30));
  await kvSet(AT, Date.now());
  return fresh;
}
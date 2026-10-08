// Dépôt « decks » : decks enregistrés et réservation des cartes qu'ils utilisent.
import { BASIC_NAMES } from "../core/cards.js";
import { reqP, tx } from "./db.js";

export function deckCards(deck) {
  const c = {};
  for (const card of deck.cards) {
    if (BASIC_NAMES.has(card.name)) continue;
    const n = card.count - (card.missing || 0); // on ne réserve que les exemplaires possédés
    if (n > 0) c[card.name] = (c[card.name] || 0) + n;
  }
  if (deck.commander) c[deck.commander.name] = (c[deck.commander.name] || 0) + 1;
  return c;
}

const pad = n => String(n).padStart(2, "0");
function localStamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export async function listDecks() {
  const all = await tx("decks", "readonly", s => reqP(s.getAll()));
  return all.sort((a, b) => b.saved_at.localeCompare(a.saved_at));
}

export async function saveDeck(name, deck, id = null) {
  const clean = { ...deck }; delete clean.suggestion;
  const entry = {
    id: id || Math.random().toString(16).slice(2, 10),
    name, format: deck.format, saved_at: localStamp(), deck: clean,
  };
  await tx("decks", "readwrite", s => { s.put(entry); });
  return entry;
}

export async function deleteDeck(id) {
  const d = await tx("decks", "readonly", s => reqP(s.get(id)));
  if (!d) return null;
  await tx("decks", "readwrite", s => { s.delete(id); });
  return d;
}

/** {nomCarte: [{id, name, count}]} : dans quels decks enregistrés chaque carte est rangée. */
export async function reservations(excludeId = null) {
  const res = {};
  for (const d of await listDecks()) {
    if (d.id === excludeId) continue;
    for (const [name, n] of Object.entries(deckCards(d.deck))) (res[name] ||= []).push({ id: d.id, name: d.name, count: n });
  }
  return res;
}

export function availableSync(collection, res) {
  const out = [];
  for (const c of collection) {
    const free = c.quantity - (res[c.name] || []).reduce((a, r) => a + r.count, 0);
    if (free > 0) out.push({ ...c, quantity: free });
  }
  return out;
}

export async function available(collection, excludeId = null) {
  return availableSync(collection, await reservations(excludeId));
}

export async function borrowReport(deck, collection, excludeId = null) {
  const res = await reservations(excludeId);
  const free = Object.fromEntries(availableSync(collection, res).map(c => [c.name, c.quantity]));
  const out = [];
  for (const [name, n] of Object.entries(deckCards(deck))) {
    const missing = n - (free[name] || 0);
    if (missing > 0 && res[name]) out.push({ name, count: missing, decks: res[name] });
  }
  return out;
}


// Sauvegarde / restauration JSON (aussi compatible avec l'export de l'ancienne appli PC).
import { copiesOf } from "../core/copies.js";
import { addCopies, loadCollection, saveCollection } from "./collectionRepo.js";
import { listDecks } from "./decksRepo.js";
import { kvGet, kvSet, tx } from "./db.js";

export async function exportBackup() {
  return { app: "mtg-deck-builder", version: 1, exported_at: new Date().toISOString(),
           collection: await loadCollection(), decks: await listDecks(), wishlist: (await kvGet("wishlist")) || [],
           gameHistory: (await kvGet("gameHistory")) || [], loans: (await kvGet("loans")) || [] };
}

export async function importBackup(data, { merge = false } = {}) {
  if (!data || !Array.isArray(data.collection)) throw new Error("Fichier de sauvegarde invalide");
  if (!merge) {
    await saveCollection(data.collection);
    await tx("decks", "readwrite", s => { s.clear(); for (const d of data.decks || []) s.put(d); });
  } else {
    for (const c of data.collection) await addCopies(c, copiesOf(c)); // exemplaires (foil, langue…) gardés
    await tx("decks", "readwrite", s => { for (const d of data.decks || []) s.put(d); });
  }
  // liste d'envies (sauvegardes récentes) : remplacée, ou complétée en mode fusion
  // (restauration complète : ce qui manque dans une ancienne sauvegarde est vidé, comme la collection est remplacée)
  if (Array.isArray(data.wishlist) || !merge) {
    const incoming = data.wishlist || [];
    const cur = merge ? (await kvGet("wishlist")) || [] : [];
    await kvSet("wishlist", [...cur.filter(w => !incoming.some(x => x.name === w.name)), ...incoming]);
  }
  // historique des parties : remplacé, ou complété en mode fusion (une partie = son heure de fin)
  if (Array.isArray(data.gameHistory) || !merge) {
    const incoming = data.gameHistory || [];
    const cur = merge ? (await kvGet("gameHistory")) || [] : [];
    const seen = new Set(incoming.map(r => r.at));
    await kvSet("gameHistory", [...incoming, ...cur.filter(r => !seen.has(r.at))].sort((a, b) => b.at - a.at));
  }
  // cartes prêtées : remplacées, ou complétées en mode fusion (sans doublon)
  if (Array.isArray(data.loans) || !merge) {
    const incoming = data.loans || [];
    const cur = merge ? (await kvGet("loans")) || [] : [];
    await kvSet("loans", [...cur.filter(l => !incoming.some(x => x.id === l.id)), ...incoming]);
  }
  return { cards: data.collection.length, decks: (data.decks || []).length };
}

export async function wipeAll() {
  await saveCollection([]);
  await tx("decks", "readwrite", s => { s.clear(); });
  await kvSet("wishlist", []);
  await kvSet("gameHistory", []);
  await kvSet("loans", []);
}

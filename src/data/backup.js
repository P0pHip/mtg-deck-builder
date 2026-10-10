// Sauvegarde / restauration JSON (aussi compatible avec l'export de l'ancienne appli PC).
import { getCard, loadCollection, saveCollection, setQuantity } from "./collectionRepo.js";
import { listDecks } from "./decksRepo.js";
import { kvGet, kvSet, tx } from "./db.js";

export async function exportBackup() {
  return { app: "mtg-deck-builder", version: 1, exported_at: new Date().toISOString(),
           collection: await loadCollection(), decks: await listDecks(), wishlist: (await kvGet("wishlist")) || [] };
}

export async function importBackup(data, { merge = false } = {}) {
  if (!data || !Array.isArray(data.collection)) throw new Error("Fichier de sauvegarde invalide");
  if (!merge) {
    await saveCollection(data.collection);
    await tx("decks", "readwrite", s => { s.clear(); for (const d of data.decks || []) s.put(d); });
  } else {
    for (const c of data.collection) {
      const cur = await getCard(c.name);
      await setQuantity(c.name, (cur?.quantity || 0) + c.quantity, c);
    }
    await tx("decks", "readwrite", s => { for (const d of data.decks || []) s.put(d); });
  }
  // liste d'envies (sauvegardes récentes) : remplacée, ou complétée en mode fusion
  if (Array.isArray(data.wishlist)) {
    const cur = merge ? (await kvGet("wishlist")) || [] : [];
    await kvSet("wishlist", [...cur.filter(w => !data.wishlist.some(x => x.name === w.name)), ...data.wishlist]);
  }
  return { cards: data.collection.length, decks: (data.decks || []).length };
}

export async function wipeAll() {
  await saveCollection([]);
  await tx("decks", "readwrite", s => { s.clear(); });
  await kvSet("wishlist", []);
}

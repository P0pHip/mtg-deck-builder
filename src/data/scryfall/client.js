// Client HTTP de l'API Scryfall (autorise les appels depuis le navigateur).
// Respecte la limite demandée par Scryfall (~10 requêtes/s).
export const API = "https://api.scryfall.com";
const HEADERS = { Accept: "application/json" };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fetchImpl = (...a) => fetch(...a);

/** Pour les tests : remplace fetch. */
export function setFetch(fn) { fetchImpl = fn; }

export async function getJSON(url) {
  const r = await fetchImpl(url, { headers: HEADERS });
  await sleep(110);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Scryfall ${r.status}`);
  return r.json();
}

export async function postCollection(identifiers) {
  const r = await fetchImpl(`${API}/cards/collection`, {
    method: "POST", headers: { ...HEADERS, "Content-Type": "application/json" }, body: JSON.stringify({ identifiers }),
  });
  await sleep(110);
  if (!r.ok) throw new Error(`Scryfall ${r.status}`);
  return r.json();
}

export const searchUrl = params => `${API}/cards/search?` + new URLSearchParams(params);

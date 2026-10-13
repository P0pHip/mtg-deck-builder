// Deck (ou classeur d'échange) partagé par lien : la liste est compressée dans le lien lui-même (…#deck=…, …#trade=…), sans serveur.
// N'utilise que les API standard (CompressionStream, TextEncoder), présentes dans les navigateurs récents et dans Node.

const PREFIX = "#deck=", TRADE = "#trade=";

const toB64url = bytes => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64url = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());

/** { name, text } → code à mettre dans le lien. */
export async function encodeDeckShare({ name = "", text }) {
  const json = new TextEncoder().encode(JSON.stringify({ v: 1, name, text }));
  return toB64url(await pipe(json, new CompressionStream("deflate-raw")));
}

/** Code du lien → { name, text }, ou null s'il est abîmé (lien coupé dans un message…). */
export async function decodeDeckShare(code) {
  try {
    const data = JSON.parse(new TextDecoder().decode(await pipe(fromB64url(code), new DecompressionStream("deflate-raw"))));
    return typeof data?.text === "string" && data.text.trim() ? { name: String(data.name || ""), text: data.text } : null;
  } catch {
    return null;
  }
}

/** Lien complet vers l'appli (`base` : adresse de l'appli, sans « # »). */
export async function deckShareUrl(base, deck) {
  return `${base.split("#")[0]}${PREFIX}${await encodeDeckShare(deck)}`;
}

/** Code de deck contenu dans un « #… » d'adresse, ou null. */
export const shareCodeOf = hash => (hash?.startsWith(PREFIX) ? hash.slice(PREFIX.length) : null);

/** Lien vers l'appli avec un classeur d'échange ({ name, text } : « 2 Sol Ring (C21) » par ligne). */
export async function tradeShareUrl(base, offer) {
  return `${base.split("#")[0]}${TRADE}${await encodeDeckShare(offer)}`;
}

/** Code de classeur contenu dans un « #… » d'adresse, ou null. */
export const tradeCodeOf = hash => (hash?.startsWith(TRADE) ? hash.slice(TRADE.length) : null);
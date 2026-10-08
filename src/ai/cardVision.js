// Reconnaissance d'une carte Magic sur une photo par le modèle local (Gemma, multimodal).
// L'IA ne fait que lire : le résultat est toujours vérifié par Scryfall avant d'être proposé.
import { generate } from "./engine.js";

const PROMPT = {
  fr: `Cette photo montre une carte Magic: The Gathering. Lis-la et réponds UNIQUEMENT avec ce JSON :
{"name":"nom exact imprimé en haut de la carte","set":"code d'extension en bas à gauche (3 à 5 caractères) ou vide","number":"numéro de collection en bas à gauche ou vide"}
N'invente rien : laisse vide ce que tu ne lis pas clairement.`,
  en: `This photo shows a Magic: The Gathering card. Read it and answer ONLY with this JSON:
{"name":"exact name printed at the top of the card","set":"set code at the bottom left (3 to 5 characters) or empty","number":"collector number at the bottom left or empty"}
Do not guess: leave empty what you cannot read clearly.`,
};

/** Réponse du modèle → { name, set, number } (champs vides possibles), ou null. Pur. */
export function parseVisionAnswer(text) {
  if (!text) return null;
  const t = text.replace(/```(?:json)?/g, "");
  const m = t.match(/\{[\s\S]*?\}/);
  let o = null;
  if (m) { try { o = JSON.parse(m[0]); } catch { o = null; } }
  if (!o) { // pas de JSON : première ligne non vide = le nom
    const line = t.split("\n").map(l => l.replace(/^[\s*"'-]*(nom|name)\s*:\s*/i, "").replace(/["*]/g, "").trim()).find(Boolean);
    o = { name: line || "" };
  }
  const name = String(o.name || "").trim();
  const set = String(o.set || "").trim().replace(/[^a-z0-9]/gi, "");
  const number = (String(o.number || "").match(/\d{1,4}/) || [""])[0].replace(/^0+(?=\d)/, "");
  if (!name && !(set && number)) return null;
  return { name, set: /^[a-z0-9]{3,5}$/i.test(set) ? set.toLowerCase() : "", number };
}

/** Photo (Blob JPEG/PNG) → { name, set, number } ou null. */
export async function readCardImage(model, image, lang = "fr", { signal } = {}) {
  const text = await generate(model, [{ role: "user", content: [{ type: "image", data: image }, { type: "text", text: PROMPT[lang] || PROMPT.fr }] }],
    { vision: true, maxOutputTokens: 120, temperature: 0.1, signal });
  return parseVisionAnswer(text);
}

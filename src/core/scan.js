// Scanner de cartes : analyse du texte lu par l'OCR (pur, sans DOM ni réseau).
// Cartes récentes (2020+) : le bas à gauche porte le numéro de collection, le code d'extension et la langue
// (« 0123 R / MID • FR ») → impression exacte. Sinon on se rabat sur le nom lu dans le cartouche du haut.

const LANGS = { EN: "en", FR: "fr", DE: "de", IT: "it", ES: "es", SP: "es", PT: "pt", JA: "ja", JP: "ja", KO: "ko", RU: "ru", ZHS: "zhs", ZHT: "zht", CS: "zhs", CT: "zht", PH: "ph" };

const fold = s => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Bas de carte → { set, number, lang } (set en minuscules, validé par `knownSets`), ou null.
 * knownSets : Set ou Map des codes d'extension Scryfall (minuscules).
 */
export function parseFooter(text, knownSets) {
  if (!text) return null;
  const has = code => knownSets.has(code.toLowerCase());
  const up = text.toUpperCase().replace(/[|]/g, "I");
  let set = null, lang = null;
  // 1) « MID • FR » (le point médian est souvent lu comme *, -, e, », . …)
  for (const m of up.matchAll(/\b([A-Z0-9]{3,5})\s*[^A-Z0-9\s]{0,3}\s*(EN|FR|DE|IT|ES|SP|PT|JA|JP|KO|RU|ZHS|ZHT|PH)\b/g)) {
    if (has(m[1])) { set = m[1]; lang = LANGS[m[2]]; break; }
  }
  // 2) sinon, un mot de 3 à 5 caractères qui est un vrai code d'extension (et contient une lettre)
  if (!set) {
    const tok = [...up.matchAll(/\b([A-Z0-9]{3,5})\b/g)].map(m => m[1]).find(w => /[A-Z]/.test(w) && has(w));
    if (tok) set = tok;
  }
  if (!set) return null;
  // numéro : de préférence « 123/277 » ou « 0123 R », sinon le premier nombre avant le code d'extension
  const before = up.slice(0, up.indexOf(set)) || up;
  const num = before.match(/\b0*(\d{1,4})\s*\/\s*\d{1,4}/) || before.match(/\b0*(\d{1,4})\s*[CURMLSTP]\b/) || before.match(/\b0*(\d{1,4})\b/);
  if (!num) return null;
  return { set: set.toLowerCase(), number: num[1], lang: lang || null };
}

/** Nom lu dans le cartouche → texte propre (ou null s'il est trop court pour être un nom). */
export function cleanTitle(text) {
  if (!text) return null;
  let t = text.replace(/[\r\n]+/g, " ")
    .replace(/[^\p{L}\s',\-]/gu, " ") // chiffres, symboles de mana mal lus…
    .replace(/\s+/g, " ").trim();
  // lettres isolées en bout de ligne (symboles de mana, bord de cadre)
  t = t.split(" ").filter((w, i, a) => w.length > 1 || (i > 0 && i < a.length - 1)).join(" ").replace(/^[',\- ]+|[',\- ]+$/g, "");
  return t.replace(/[^\p{L}]/gu, "").length >= 3 ? t : null;
}

/** Distance d'édition (Levenshtein). */
export function editDistance(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/** Ressemblance 0..1 entre le texte lu et un nom de carte (accents et casse ignorés ; face avant seulement). */
export function similarity(read, name) {
  const a = fold(read).replace(/[^a-z0-9]/g, ""), b = fold((name || "").split(" // ")[0]).replace(/[^a-z0-9]/g, "");
  if (!a || !b) return 0;
  return 1 - editDistance(a, b) / Math.max(a.length, b.length);
}

/** Meilleure carte d'une liste pour un nom lu (EN ou FR), si la ressemblance est suffisante. */
export function bestNameMatch(read, cards, min = 0.75) {
  let best = null, score = 0;
  for (const c of cards) {
    const s = Math.max(similarity(read, c.name), similarity(read, c.fr?.name));
    if (s > score) { best = c; score = s; }
  }
  return score >= min ? { card: best, score } : null;
}

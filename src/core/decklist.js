// Lecture d'une decklist collée (Arena, MTGO, Moxfield, Archidekt, liste simple). Pur.
//   « 4 Lightning Bolt », « 4x Lightning Bolt », « 1 Sol Ring (C21) 263 », « SB: 2 Duress »,
//   sections « Commander », « Deck », « Sideboard »… (avec ou sans « : », ou en commentaire « // Sideboard »),
//   et, sans section : un bloc final séparé par une ligne vide = réserve (MTGO), ou commandant s'il est seul (Moxfield).

const SECTIONS = [
  ["commander", /^(commanders?|commandants?)$/],
  ["companion", /^(companions?|compagnons?)$/],
  ["main", /^(deck|main|mainboard|main deck|maindeck|decklist|deck principal|bibliothèque|library)$/],
  ["side", /^(sideboard|side|réserve|reserve)$/],
  ["skip", /^(maybeboard|maybe|considering|tokens?|jetons?|attractions?|stickers?)$/],
  ["about", /^about$/],
];

/** En-tête de section (« Sideboard », « SIDEBOARD: », « // Commander », « Deck (60) ») → nom de section, sinon null. */
function sectionOf(line) {
  const l = line.replace(/^(\/\/|#)\s*/, "").replace(/\s*\(\d+\)\s*$/, "").replace(/\s*:\s*$/, "").trim().toLowerCase();
  return SECTIONS.find(([, rx]) => rx.test(l))?.[0] || null;
}

/** Ligne de carte → { count, name, set, number } ou null. */
export function parseCardLine(line) {
  // annotations en fin de ligne, dans n'importe quel ordre : catégorie Archidekt « [Ramp] », étiquette « ^Have,#37d67a^ »,
  // finition Moxfield « *F* » / « *E* », « (foil) »
  let l = line.trim(), prev;
  do {
    prev = l;
    l = l.replace(/\s+(\[[^\]]*\]|\^[^^]*\^|\*[A-Z]+\*|\((F|foil|etched)\))$/i, "").trim();
  } while (l !== prev);
  if (!l) return null;
  const m = l.match(/^(\d+)\s*x?\s+(.+)$/i);
  const count = m ? +m[1] : 1;
  let rest = (m ? m[2] : l).trim();
  let set = "", number = "";
  const p = rest.match(/^(.*?)\s+\(([A-Za-z0-9]{2,6})\)(?:\s+([A-Za-z0-9★†-]+))?$/);
  if (p) { rest = p[1]; set = p[2].toLowerCase(); number = p[3] || ""; }
  rest = rest.replace(/\s+\/\s+/g, " // ").replace(/\s{2,}/g, " ").trim(); // « Fire / Ice » → « Fire // Ice »
  if (!rest || count < 1 || /^\d+$/.test(rest)) return null;
  return { count, name: rest, set, number };
}

const total = list => list.reduce((a, c) => a + c.count, 0);

/**
 * Texte → { name, commander: [...], main: [...], side: [...], ignored: [lignes non comprises] }.
 * Chaque carte : { count, name, set, number }.
 */
export function parseDecklist(text) {
  const out = { name: "", commander: [], main: [], side: [], ignored: [] };
  const lines = (text || "").replace(/\r/g, "").split("\n");
  const hasSections = lines.some(l => l.trim() && sectionOf(l.trim()) && sectionOf(l.trim()) !== "about");
  let section = "main", aboutNext = false;
  const blocks = [[]]; // sans sections : blocs séparés par des lignes vides
  const sb = [];       // lignes « SB: » (MTGO), ajoutées à la fin de la réserve

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { if (!hasSections && blocks.at(-1).length) blocks.push([]); continue; }
    const sec = sectionOf(line);
    if (sec === "about") { aboutNext = true; continue; }
    if (aboutNext && /^name\s+/i.test(line)) { out.name = line.replace(/^name\s+/i, "").trim(); continue; }
    if (sec) { section = sec === "companion" ? "side" : sec; aboutNext = false; continue; }
    if (/^(\/\/|#)/.test(line)) continue; // commentaire
    const isSb = /^SB:\s*/i.test(line);
    const card = parseCardLine(line.replace(/^SB:\s*/i, ""));
    if (!card) { out.ignored.push(line); continue; }
    if (isSb) sb.push(card);
    else if (hasSections) { if (section !== "skip") out[section].push(card); }
    else blocks.at(-1).push(card);
  }

  if (!hasSections) {
    const bs = blocks.filter(b => b.length);
    const rest = bs.length > 1 ? bs.slice(0, -1).flat() : [];
    if (bs.length === 1) out.main.push(...bs[0]);
    else if (bs.length > 1 && total(bs.at(-1)) <= 2 && total(rest) >= 95) { out.main.push(...rest); out.commander.push(...bs.at(-1)); }
    else if (bs.length > 1 && total(bs[0]) <= 2 && total(bs.slice(1).flat()) >= 95) { out.commander.push(...bs[0]); out.main.push(...bs.slice(1).flat()); }
    else if (bs.length > 1) { out.main.push(...rest); out.side.push(...bs.at(-1)); }
  }
  out.side.push(...sb);
  return out;
}

/**
 * Deck → texte à coller ailleurs. Pur.
 *   style « text » (Moxfield, Archidekt, EDHREC, Cardmarket…) : noms complets (« Fire // Ice ») ;
 *   style « arena » (MTG Arena) : face avant seulement, comme Arena l'attend (« Delver of Secrets »).
 * Sections « Commander » / « Deck » quand il y a un commandant (comprises par ces sites et par l'import de l'appli).
 */
export function formatDecklist(deck, style = "text") {
  const nm = n => (style === "arena" ? n.split(" // ")[0] : n);
  const isLand = c => c.category === "land" || /\bLand\b/.test((c.type_line || "").split(" // ")[0]); // terrains à la fin
  const cards = [...(deck?.cards || [])].sort((a, b) => isLand(a) - isLand(b) || a.name.localeCompare(b.name));
  const lines = cards.map(c => `${c.count} ${nm(c.name)}`);
  return deck?.commander ? ["Commander", `1 ${nm(deck.commander.name)}`, "", "Deck", ...lines].join("\n") : lines.join("\n");
}
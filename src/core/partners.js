// Commandants à deux : Partner, Partner with, Friends forever, Choose a Background, Doctor's companion. Pur.
// Un deck à deux commandants garde `deck.commander` (le principal) et ajoute `deck.partner` ; l'identité est l'union des deux.

const lines = c => (c.oracle_text || "").split(/\n| \/\/ /).map(l => l.replace(/\s*\(.*?\)\s*$/, "").trim());
const kw = (c, k) => (c.keywords || []).some(x => x.toLowerCase() === k);
const typeOf = c => (c.type_line || "").split(" // ")[0];

/**
 * Capacité « à deux » d'une carte : { kind, name?, group? } ou null.
 * kind : "partner" | "with" (name = le partenaire attitré) | "group" (Partner—Survivors, Partner—Friends forever… : même groupe) |
 *        "chooseBackground" | "background" | "companion" (Doctor's companion) | "doctor" (Time Lord Doctor).
 */
export function partnerKind(c) {
  if (!c) return null;
  const ls = lines(c);
  const withLine = ls.find(l => /^Partner with /i.test(l));
  if (withLine) return { kind: "with", name: withLine.replace(/^Partner with /i, "").trim() };
  const group = ls.find(l => /^Partner—/i.test(l));
  if (group) return { kind: "group", group: group.replace(/^Partner—/i, "").trim().toLowerCase() };
  if (ls.some(l => /^Partner$/i.test(l)) || kw(c, "partner")) return { kind: "partner" };
  // ancien texte « Friends forever » = « Partner—Friends forever » d'aujourd'hui (cartes gardées en cache)
  if (ls.some(l => /^Friends forever$/i.test(l)) || kw(c, "friends forever")) return { kind: "group", group: "friends forever" };
  if (ls.some(l => /^Choose a Background$/i.test(l)) || kw(c, "choose a background")) return { kind: "chooseBackground" };
  if (ls.some(l => /^Doctor's companion$/i.test(l)) || kw(c, "doctor's companion")) return { kind: "companion" };
  if (/\bBackground\b/.test(typeOf(c)) && /\bLegendary\b/.test(typeOf(c))) return { kind: "background" };
  if (/\bTime Lord Doctor\b/.test(typeOf(c)) && /\bLegendary\b/.test(typeOf(c))) return { kind: "doctor" };
  return null;
}

/** Ces deux cartes peuvent-elles être commandants ensemble ? */
export function canPair(a, b) {
  if (!a || !b || a.name === b.name) return false;
  const x = partnerKind(a), y = partnerKind(b);
  if (!x || !y) return false;
  const same = k => x.kind === k && y.kind === k;
  const either = (k1, k2) => (x.kind === k1 && y.kind === k2) || (x.kind === k2 && y.kind === k1);
  if (x.kind === "with" || y.kind === "with") return (x.kind === "with" && x.name === b.name) || (y.kind === "with" && y.name === a.name);
  return same("partner") || (same("group") && x.group === y.group)
    || either("chooseBackground", "background") || either("companion", "doctor");
}

/** Peut avoir un second commandant (sert à afficher le choix du partenaire). Un Background seul n'est pas commandant. */
export const hasPartnerAbility = c => !!partnerKind(c) && partnerKind(c).kind !== "background";

/** Partenaires possibles d'un commandant dans la collection (légaux en Commander), par ordre alphabétique. */
export function partnersFor(cmd, collection) {
  return collection.filter(c => c.legalities?.commander === "legal" && canPair(cmd, c)).sort((a, b) => a.name.localeCompare(b.name));
}

/** Le ou les commandants d'un deck (zone de commandement). */
export const commandZone = deck => [deck?.commander, deck?.partner].filter(Boolean);

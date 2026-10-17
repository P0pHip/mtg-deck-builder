// Base des combos téléchargée (fichier complet de Commander Spellbook) : lecture au fil de l'eau, forme compacte, recherche. Pur.
// Le fichier fait ~690 Mo décompressé (images, prix… pour chaque carte) : on le lit morceau par morceau sans jamais le garder
// en entier, et on ne retient que ce que l'appli affiche.
//   index   : { names: [noms de cartes], v: [[cartes (indices dans names), identité, formats interdits (bits), popularité,
//               nombre de « une carte avec… » demandées]], pack }
//   détails : un tableau par combo (id, prérequis, déroulé…), dans le même ordre, par paquets de `pack` combos.

/**
 * Découpe le texte JSON du fichier (reçu par morceaux) en combos : `push(texte)` retourne les objets complets trouvés.
 * Un combo = un objet au 3ᵉ niveau ({ "variants": [ {…}, … ] }) ; chaînes et échappements respectés.
 */
export function variantSplitter() {
  let depth = 0, inStr = false, esc = false, parts = null, seen = false;
  return {
    push(chunk) {
      const out = [];
      let start = parts ? 0 : -1;
      for (let i = 0; i < chunk.length; i++) {
        const c = chunk.charCodeAt(i);
        if (inStr) {
          if (esc) esc = false;
          else if (c === 92) esc = true;        // \
          else if (c === 34) inStr = false;     // "
          continue;
        }
        if (c === 34) inStr = true;
        else if (c === 123 || c === 91) {       // { [
          if (depth === 2 && c === 123) { parts = []; start = i; }
          depth++;
        } else if (c === 125 || c === 93) {     // } ]
          depth--;
          if (depth === 2 && parts) {
            parts.push(chunk.slice(start, i + 1));
            out.push(JSON.parse(parts.join("")));
            parts = null; start = -1;
          }
        }
      }
      if (parts && start >= 0) parts.push(chunk.slice(start));
      seen = true;
      return out;
    },
    /** Le fichier reçu est entier (toutes les accolades refermées) : sinon la connexion a coupé en route. */
    get complete() { return seen && depth === 0 && !inStr && !parts; },
  };
}

// formats de l'appli → clé de légalité chez Commander Spellbook
export const COMBO_FORMATS = ["commander", "standard", "pioneer", "modern", "legacy", "vintage", "pauper", "brawl", "oathbreaker", "premodern"];
const COLORS = "WUBRG";
const identityBits = s => [...(s || "")].reduce((m, ch) => m | (COLORS.includes(ch) ? 1 << COLORS.indexOf(ch) : 0), 0);

/**
 * Construit la base compacte au fil des combos reçus : `add(v)` pour chaque objet du fichier, `takePacks()` rend les
 * paquets de détails déjà pleins (à ranger tout de suite, pour ne pas tout garder en mémoire), `done()` l'index final.
 */
export function comboBaseBuilder({ pack = 250 } = {}) {
  const names = [], ids = new Map(), v = [];
  let cur = [], full = [];
  const nameId = n => {
    if (!ids.has(n)) { ids.set(n, names.length); names.push(n); }
    return ids.get(n);
  };
  return {
    add(x) {
      if (x.status && x.status !== "OK" && x.status !== "E") return; // brouillons, combos refusés
      const cards = (x.uses || []).map(u => u.card?.name).filter(Boolean);
      if (!cards.length) return; // pas un combo (le fichier contient aussi une liste d'alias)
      const banned = COMBO_FORMATS.reduce((m, f, i) => m | (x.legalities?.[f] === false ? 1 << i : 0), 0);
      v.push([cards.map(nameId), identityBits(x.identity), banned, x.popularity || 0, (x.requires || []).length]);
      cur.push([
        x.id,
        (x.requires || []).map(r => r.template?.name).filter(Boolean),
        (x.produces || []).map(p => p.feature?.name).filter(Boolean),
        x.description || "",
        [x.easyPrerequisites, x.notablePrerequisites].filter(Boolean).join("\n"),
        x.manaNeeded || "",
      ]);
      if (cur.length === pack) { full.push(cur); cur = []; }
    },
    get count() { return v.length; },
    takePacks() { const out = full; full = []; return out; },
    done() {
      if (cur.length) { full.push(cur); cur = []; }
      return { names, v, pack };
    },
  };
}

const keys = n => [n.toLowerCase(), n.split(" // ")[0].toLowerCase()];

/**
 * Combos complets ou à une carte près pour ces cartes (comme la recherche en ligne) : numéros des combos dans l'index.
 * `identity` (couleurs du deck ou de son commandant, ex. ["U","G"]) : si donnée, un combo incomplet doit rester dans ces couleurs.
 * Les « une carte avec… » ne peuvent pas être vérifiées hors ligne (le serveur les cherche dans le deck) : comptées présentes
 * pour un combo complet, absentes pour un combo à une carte près — à 1 ou 2 combos près, la même réponse que le serveur.
 */
export function matchCombos(index, names, identity = null) {
  const inDeck = new Set(names.flatMap(keys));
  const present = index.names.map(n => keys(n).some(k => inDeck.has(k)));
  const allowed = identity ? identityBits(identity.join("")) : 31;
  const out = [];
  index.v.forEach(([cards, ident, , , templates], i) => {
    let missing = 0;
    for (const c of cards) if (!present[c] && ++missing > 1) return;
    // à une carte près : dans les couleurs, et sans « une créature avec… » en plus (sinon il manque deux pièces)
    if (missing === 1 && ((ident & ~allowed) || templates)) return;
    out.push(i);
  });
  return out;
}

/** Combo n° i, sans ses textes : ce qu'il faut pour le classer (voir core/combos.js). `ref` sert à retrouver ses détails. */
export function comboFromBase(index, i) {
  const [cards, , banned, popularity] = index.v[i];
  const legal = Object.fromEntries(COMBO_FORMATS.map((f, b) => [f, !(banned & (1 << b))]));
  return { ref: i, cards: cards.map(c => index.names[c]), popularity, legal };
}

/** Détails d'un combo (rangés dans les paquets) → champs « slim » de l'appli (voir data/spellbook.js slimVariant). */
export function comboDetails(d) {
  const [id, requires, produces, description, prerequisites, mana] = d;
  return { id, requires, produces, description, prerequisites, mana };
}

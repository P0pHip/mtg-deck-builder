import { afterEach, describe, expect, it, vi } from "vitest";
import { comboBaseBuilder, comboDetails, comboFromBase, matchCombos, variantSplitter } from "../../src/core/comboBase.js";

const variant = (id, cards, extra = {}) => ({
  id, status: "OK", identity: "UR", popularity: 10,
  uses: cards.map(name => ({ card: { name, imageUriFrontPng: "https://x/{y}.png" }, zoneLocations: ["B"] })),
  requires: [], produces: [{ feature: { name: "Infinite tokens" } }],
  description: 'Tap "it" {T}.\nRepeat [x].', easyPrerequisites: "On the battlefield.", notablePrerequisites: "", manaNeeded: "{2}{R}",
  legalities: { commander: true, modern: true, standard: false }, ...extra,
});
const fileText = vs => JSON.stringify({ timestamp: "2026-10-16T19:13:38+00:00", version: "7", variants: vs, aliases: [{ id: "1-2", variant: null }] });

/** Coupe le texte en morceaux de taille `n` et rend les objets trouvés. */
function splitAll(text, n) {
  const s = variantSplitter(), out = [];
  for (let i = 0; i < text.length; i += n) out.push(...s.push(text.slice(i, i + n)));
  return out;
}

describe("base des combos téléchargée", () => {
  const vs = [
    variant("1-2", ["Splinter Twin", "Pestermite"]),
    variant("3-4", ["Kiki-Jiki, Mirror Breaker", "Zealous Conscripts"], { identity: "R", popularity: 50 }),
    variant("5-6", ["Thassa's Oracle", "Demonic Consultation"], { identity: "UB", legalities: { modern: false } }),
    variant("7", ["Draft"], { status: "D" }),
  ];

  it("lit le fichier morceau par morceau, quelle que soit la coupure (chaînes avec { } \" échappés)", () => {
    const text = fileText(vs);
    for (const n of [1, 7, 64, text.length]) {
      const got = splitAll(text, n);
      expect(got.map(v => v.id)).toEqual(["1-2", "3-4", "5-6", "7", "1-2"]); // les alias aussi : écartés plus loin
      expect(got[0].description).toBe('Tap "it" {T}.\nRepeat [x].');
    }
  });

  it("forme compacte : brouillons et alias écartés, détails par paquets", () => {
    const b = comboBaseBuilder({ pack: 2 });
    for (const v of splitAll(fileText(vs), 50)) b.add(v);
    expect(b.count).toBe(3);
    const packs = b.takePacks();
    expect(packs).toHaveLength(1);
    const index = b.done();
    packs.push(...b.takePacks());
    expect(packs.map(p => p.length)).toEqual([2, 1]);
    expect(index.names).toHaveLength(6);
    const v = comboFromBase(index, 2);
    expect(v).toMatchObject({ ref: 2, cards: ["Thassa's Oracle", "Demonic Consultation"], popularity: 10 });
    expect(v.legal.modern).toBe(false);
    expect(v.legal.commander).toBe(true);
    expect(comboDetails(packs[1][0])).toEqual({
      id: "5-6", requires: [], produces: ["Infinite tokens"], description: 'Tap "it" {T}.\nRepeat [x].',
      prerequisites: "On the battlefield.", mana: "{2}{R}",
    });
  });

  it("combos complets ou à une carte près ; avec un commandant, la carte manquante doit être dans ses couleurs", () => {
    const b = comboBaseBuilder();
    vs.forEach(v => b.add(v));
    const index = b.done();
    expect(matchCombos(index, ["Splinter Twin", "Pestermite", "Kiki-Jiki, Mirror Breaker", "Thassa's Oracle"])).toEqual([0, 1, 2]);
    expect(matchCombos(index, ["Kiki-Jiki, Mirror Breaker", "Thassa's Oracle"], ["R"])).toEqual([1]); // Oracle + Consultation : bleu-noir
    expect(matchCombos(index, ["Lightning Bolt"])).toEqual([]);
    // il faut aussi « une créature avec… » : complet, il compte ; à une carte près, non (il manque deux pièces)
    const t = comboBaseBuilder();
    t.add(variant("8", ["Viscera Seer", "Mikaeus, the Unhallowed"], { requires: [{ template: { name: "Persist Creature" } }] }));
    expect(matchCombos(t.done(), ["Viscera Seer", "Mikaeus, the Unhallowed"])).toEqual([0]);
    expect(matchCombos(t.done(), ["Viscera Seer"])).toEqual([]);
  });
});

// ------------------------------------------------------------------ téléchargement (fetch et Cache API simulés)
function fakeCaches() {
  const stores = new Map();
  const open = async name => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    return {
      put: async (k, r) => { m.set(k, new Uint8Array(await r.arrayBuffer())); },
      match: async k => (m.has(k) ? new Response(m.get(k)) : undefined),
      keys: async () => [...m.keys()].map(url => ({ url })),
      delete: async k => m.delete(typeof k === "string" ? k : k.url),
    };
  };
  return { stores, open, has: async n => stores.has(n), delete: async n => stores.delete(n) };
}

describe("base des combos : téléchargement, recherche, suppression", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it("garde l'index et les textes compressés, retrouve les combos du deck, puis se supprime", async () => {
    const caches = fakeCaches();
    vi.stubGlobal("caches", caches);
    const vs = Array.from({ length: 600 }, (_, i) => variant(`v${i}`, [`Card ${i}`, `Card ${i + 1}`], { popularity: i }));
    const gz = await new Response(new Blob([fileText(vs)]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(gz, { headers: { "content-length": String(gz.byteLength) } })));
    const cb = await import("../../src/data/comboBase.js");

    expect(await cb.comboBaseInfo()).toBeNull();
    const progress = [];
    const meta = await cb.downloadComboBase({ onProgress: (p, n) => progress.push([p, n]) });
    expect(meta).toMatchObject({ count: 600, source: "2026-10-16T19:13:38+00:00" });
    expect(progress.at(-1)[1]).toBe(600);
    expect(progress.every(([p]) => p > 0 && p < 1)).toBe(true);
    expect((await cb.comboBaseInfo()).stamp).toBe(meta.stamp);

    const found = await cb.searchComboBase(["Card 300", "Card 301"]);
    expect(found.map(v => v.cards.join("+"))).toEqual(["Card 299+Card 300", "Card 300+Card 301", "Card 301+Card 302"]);
    expect(found[0].id).toBeUndefined();
    await cb.fillComboDetails(found);
    expect(found.map(v => v.id)).toEqual(["v299", "v300", "v301"]);
    expect(found[1].description).toBe('Tap "it" {T}.\nRepeat [x].');

    // mise à jour : l'ancienne base est remplacée, rien ne traîne
    const before = caches.stores.get("mtg-combos").size;
    await new Promise(r => setTimeout(r, 2)); // autre horodatage
    await cb.downloadComboBase();
    expect(caches.stores.get("mtg-combos").size).toBe(before);

    await cb.removeComboBase();
    expect(await cb.comboBaseInfo()).toBeNull();
    expect(await cb.searchComboBase(["Card 1"])).toBeNull();
  });

  it("un fichier coupé en route ou vide est refusé, sans rien laisser", async () => {
    const caches = fakeCaches();
    vi.stubGlobal("caches", caches);
    const many = Array.from({ length: 300 }, (_, i) => variant(`v${i}`, [`A${i}`, `B${i}`]));
    const text = fileText(many);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(text.slice(0, text.length - 500))));
    const cb = await import("../../src/data/comboBase.js");
    await expect(cb.downloadComboBase()).rejects.toThrow("truncated");
    expect([...caches.stores.get("mtg-combos").keys()]).toEqual([]); // les paquets déjà rangés sont retirés
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"variants": []}')));
    await expect(cb.downloadComboBase()).rejects.toThrow("no-combos");
    expect(await cb.comboBaseInfo()).toBeNull();
  });
});

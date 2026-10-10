import { describe, expect, it } from "vitest";
import { setFetch } from "../../src/data/scryfall/client.js";
import { identify, identifyFromAi } from "../../src/services/scanService.js";

const card = (name, set, number, extra = {}) => ({ object: "card", name, set, set_name: set.toUpperCase(), collector_number: number, lang: "en",
  oracle_id: "o-" + name, type_line: "Creature", legalities: {}, color_identity: [], prices: { eur: "1.00" }, ...extra });
const SHEOLDRED = card("Sheoldred, the Apocalypse", "dmu", "107");
const SHEOLDRED_FR = { ...SHEOLDRED, lang: "fr", printed_name: "Sheoldred, l'Apocalypse" };
const json = body => ({ ok: true, status: 200, json: async () => body });
const missing = { ok: false, status: 404, json: async () => ({}) };

/** Faux Scryfall : impression par extension/numéro(/langue), recherche floue par nom, recherche FR, traductions. */
function fakeScryfall(calls = []) {
  setFetch(async url => {
    calls.push(url);
    const u = new URL(url);
    if (u.pathname === "/cards/dmu/107/fr") return json(SHEOLDRED_FR);
    if (u.pathname === "/cards/dmu/107") return json(SHEOLDRED);
    if (u.pathname === "/cards/named") return /sheoldred/i.test(u.searchParams.get("fuzzy")) ? json(SHEOLDRED) : missing;
    if (u.pathname === "/cards/search") return json({ data: [], has_more: false });
    return missing;
  });
}
const sets = new Set(["dmu", "mid"]);

describe("scanner : identification d'après le texte lu", () => {
  it("bas de carte lisible → impression exacte (dans la langue lue)", async () => {
    fakeScryfall();
    const hit = await identify({ title: "Sheoldred, l'Apocalypse", footer: "0107 M\nDMU • FR  Chris Rahn" }, { knownSets: sets });
    expect(hit).toMatchObject({ how: "footer", card: { name: "Sheoldred, the Apocalypse", set: "dmu", lang: "fr", collector: "107" } });
  });

  it("bas de carte illisible → par le nom (et seulement si le nom lu ressemble vraiment)", async () => {
    fakeScryfall();
    expect(await identify({ title: "Sheoldred the Apocalypse", footer: "~~~" }, { knownSets: sets })).toMatchObject({ how: "name" });
    expect(await identify({ title: "", footer: "" }, { knownSets: sets })).toBeNull();
  });

  it("garde en mémoire ce qu'il a déjà demandé (pas de nouvel appel pour la même lecture)", async () => {
    const calls = [];
    fakeScryfall(calls);
    await identify({ title: "Sheoldred Apocalypse", footer: "" }, { knownSets: sets });
    const n = calls.length;
    await identify({ title: "Sheoldred Apocalypse", footer: "" }, { knownSets: sets });
    expect(calls.length).toBe(n);
  });

  it("hors ligne : un nom lu proche d'une carte de la collection suffit", async () => {
    setFetch(async () => { throw new Error("offline"); });
    const local = [{ name: "Llanowar Elves", set: "m19", fr: { name: "Elfes de Llanowar" } }];
    expect(await identify({ title: "Elfes de Llanowr", footer: "" }, { knownSets: sets, localCards: local })).toMatchObject({ how: "local", card: { name: "Llanowar Elves" } });
  });
});

describe("scanner : lecture faite par l'IA", () => {
  it("extension + numéro vérifiés par Scryfall ; un numéro qui ne colle pas au nom est ignoré", async () => {
    fakeScryfall();
    expect(await identifyFromAi({ name: "Sheoldred, the Apocalypse", set: "dmu", number: "107" }, { lang: "en" })).toMatchObject({ how: "ai-exact" });
    // l'IA n'a lu que le début du nom : l'impression (extension + numéro) est quand même la bonne
    expect(await identifyFromAi({ name: "Sheoldred", set: "dmu", number: "107" }, { lang: "en" })).toMatchObject({ how: "ai-exact" });
    expect(await identifyFromAi({ name: "Sheo", set: "dmu", number: "107" }, { lang: "en" })).toBeNull(); // trop court pour conclure
    expect(await identifyFromAi({ name: "Totally Different Card", set: "dmu", number: "107" }, { lang: "en" })).toBeNull();
    expect(await identifyFromAi(null)).toBeNull();
  });
});

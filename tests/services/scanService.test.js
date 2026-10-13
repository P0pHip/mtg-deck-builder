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
    if (u.pathname === "/cards/dmu/107" || u.pathname === "/cards/dmu/107/en") return json(SHEOLDRED);
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
    expect(await identify({ title: "Forêt", footer: "" }, { knownSets: sets, localCards: local })).toBeNull(); // trop éloigné
  });

  it("nom illisible mais bas de carte lisible → impression exacte quand même", async () => {
    fakeScryfall();
    const hit = await identify({ title: "~ ~", footer: "0107 M\nDMU • FR  Chris Rahn" }, { knownSets: sets });
    expect(hit).toMatchObject({ how: "footer", card: { name: "Sheoldred, the Apocalypse", lang: "fr" }, key: "dmu:Sheoldred, the Apocalypse" });
  });

  it("bas de carte qui ne colle pas au nom lu (numéro mal lu) → le nom l'emporte", async () => {
    fakeScryfall();
    const local = [{ name: "Llanowar Elves", set: "m19" }];
    const hit = await identify({ title: "Llanowar Elves", footer: "0107 M\nDMU • EN" }, { knownSets: sets, localCards: local });
    expect(hit).toMatchObject({ how: "local", card: { name: "Llanowar Elves" } });
  });

  it("la recherche floue de Scryfall est rejetée si la carte renvoyée ne ressemble pas au nom lu", async () => {
    fakeScryfall();
    expect(await identify({ title: "Sheoldred Zzzzzzzzzzzzzzzzzz", footer: "" }, { knownSets: sets })).toBeNull();
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

  it("impression demandée dans la langue de l'appli (nom imprimé en français reconnu)", async () => {
    fakeScryfall();
    const hit = await identifyFromAi({ name: "Sheoldred, l'Apocalypse", set: "dmu", number: "107" }, { lang: "fr" });
    expect(hit).toMatchObject({ how: "ai-exact", card: { lang: "fr" }, key: "dmu:Sheoldred, the Apocalypse" });
  });

  it("sans nom lu, l'extension + le numéro suffisent s'ils existent", async () => {
    fakeScryfall();
    expect(await identifyFromAi({ name: "", set: "dmu", number: "107" }, { lang: "en" })).toMatchObject({ how: "ai-exact" });
    expect(await identifyFromAi({ name: "", set: "dmu", number: "999" }, { lang: "en" })).toBeNull();
  });

  it("sans extension ni numéro → recherche par le nom seulement", async () => {
    const calls = [];
    fakeScryfall(calls);
    expect(await identifyFromAi({ name: "Sheoldred, the Apocalypse" }, { lang: "en" })).toMatchObject({ how: "ai", card: { name: "Sheoldred, the Apocalypse" } });
    expect(calls.some(u => new URL(u).pathname.startsWith("/cards/dmu"))).toBe(false);
  });

  it("impression introuvable → repli sur la recherche par nom", async () => {
    fakeScryfall();
    expect(await identifyFromAi({ name: "Sheoldred, the Apocalypse", set: "dmu", number: "999" }, { lang: "en" })).toMatchObject({ how: "ai" });
  });

  it("carte inconnue de Scryfall (ou hors ligne) → carte proche de la collection, sinon rien", async () => {
    const local = [{ name: "Llanowar Elves", set: "m19", fr: { name: "Elfes de Llanowar" } }];
    fakeScryfall();
    expect(await identifyFromAi({ name: "Elfes de Llanowar" }, { localCards: local })).toMatchObject({ how: "ai", card: { name: "Llanowar Elves" } });
    setFetch(async () => { throw new Error("offline"); });
    expect(await identifyFromAi({ name: "Llanowar Elfs", set: "m19", number: "314" }, { lang: "en", localCards: local })).toMatchObject({ how: "ai", card: { name: "Llanowar Elves" } });
    expect(await identifyFromAi({ name: "Forêt" }, { localCards: local })).toBeNull();
  });
});

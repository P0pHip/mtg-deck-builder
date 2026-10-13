import { describe, expect, it } from "vitest";
import { canPair, commandZone, hasPartnerAbility, partnerKind, partnersFor } from "../../src/core/partners.js";

const legal = { legalities: { commander: "legal" } };
const tymna = { name: "Tymna the Weaver", type_line: "Legendary Creature — Human Cleric", oracle_text: "Lifelink\nAt the beginning of your postcombat main phase, …\nPartner (You can have two commanders if both have partner.)", keywords: ["Lifelink", "Partner"], ...legal };
const kraum = { name: "Kraum, Ludevic's Opus", type_line: "Legendary Creature — Zombie Horror", oracle_text: "Flying, haste\n…\nPartner (You can have two commanders if both have partner.)", keywords: ["Flying", "Haste", "Partner"], ...legal };
const pir = { name: "Pir, Imaginative Rascal", type_line: "Legendary Creature — Human", oracle_text: "Partner with Toothy, Imaginary Friend (When this creature enters, target player may put Toothy into their hand from their library, then shuffle.)\nIf one or more counters…", keywords: ["Partner with"], ...legal };
const toothy = { name: "Toothy, Imaginary Friend", type_line: "Legendary Creature — Illusion", oracle_text: "Partner with Pir, Imaginative Rascal (…)\nWhenever you draw a card…", keywords: ["Partner with"], ...legal };
const wilson = { name: "Wilson, Refined Grizzly", type_line: "Legendary Creature — Bear Warrior", oracle_text: "Choose a Background (You can have a Background as a second commander.)\nReach, trample", keywords: ["Choose a background"], ...legal };
const bg = { name: "Raised by Giants", type_line: "Legendary Enchantment — Background", oracle_text: "Commander creatures you own have base power and toughness 10/10 and are Giants in addition to their other types.", ...legal };
const doctor = { name: "The Tenth Doctor", type_line: "Legendary Creature — Time Lord Doctor", oracle_text: "Allons-y! — …", ...legal };
const rose = { name: "Rose Tyler", type_line: "Legendary Creature — Human", oracle_text: "…\nDoctor's companion (You can have two commanders if the other is the Doctor.)", keywords: ["Doctor's companion"], ...legal };
const friend = n => ({ name: n, type_line: "Legendary Creature — Human", oracle_text: "Friends forever (You can have two commanders if both have friends forever.)", keywords: ["Friends forever"], ...legal });
const alone = { name: "Atraxa, Praetors' Voice", type_line: "Legendary Creature — Phyrexian Angel Horror", oracle_text: "Flying, vigilance, deathtouch, lifelink", ...legal };

describe("commandants à deux", () => {
  it("reconnaît chaque capacité", () => {
    expect([tymna, pir, wilson, bg, doctor, rose, friend("A"), alone].map(c => partnerKind(c)?.kind ?? null))
      .toEqual(["partner", "with", "chooseBackground", "background", "doctor", "companion", "group", null]);
    expect(partnerKind(pir).name).toBe("Toothy, Imaginary Friend");
  });

  it("associations permises (dans les deux sens) et interdites", () => {
    expect(canPair(tymna, kraum)).toBe(true);
    expect(canPair(pir, toothy)).toBe(true);
    expect(canPair(pir, tymna)).toBe(false);          // « Partner with » : seulement le partenaire attitré
    expect(canPair(wilson, bg) && canPair(bg, wilson)).toBe(true);
    expect(canPair(doctor, rose) && canPair(rose, doctor)).toBe(true);
    expect(canPair(friend("A"), friend("B"))).toBe(true);
    expect(canPair(friend("A"), tymna)).toBe(false);  // Friends forever ≠ Partner
    expect(canPair(wilson, tymna)).toBe(false);
    expect(canPair(tymna, tymna)).toBe(false);
    expect(canPair(alone, tymna)).toBe(false);
  });

  it("partenaires possibles dans la collection ; un Background seul n'est pas un commandant", () => {
    expect(partnersFor(tymna, [kraum, pir, alone, { ...friend("X") }]).map(c => c.name)).toEqual(["Kraum, Ludevic's Opus"]);
    expect(partnersFor(wilson, [bg, tymna]).map(c => c.name)).toEqual(["Raised by Giants"]);
    expect(hasPartnerAbility(wilson)).toBe(true);
    expect(hasPartnerAbility(bg)).toBe(false);
    expect(hasPartnerAbility(alone)).toBe(false);
  });

  it("zone de commandement d'un deck", () => {
    expect(commandZone({ commander: tymna, partner: kraum }).map(c => c.name)).toEqual(["Tymna the Weaver", "Kraum, Ludevic's Opus"]);
    expect(commandZone({ commander: alone })).toHaveLength(1);
    expect(commandZone({})).toEqual([]);
  });
});

import { readFileSync } from "node:fs";
import { bestPartner, buildCommander, deckFromList } from "../../src/core/builder.js";
import { formatDecklist } from "../../src/core/decklist.js";

describe("deck à deux commandants", () => {
  const col = JSON.parse(readFileSync(new URL("../fixtures/collection_random.json", import.meta.url)));
  const T = { ...tymna, color_identity: ["W", "B"], quantity: 1, cmc: 2, mana_cost: "{1}{W}{B}" };
  const K = { ...kraum, color_identity: ["U", "R"], quantity: 1, cmc: 5, mana_cost: "{3}{U}{R}" };
  const all = [...col, T, K];

  it("identité commune, 98 cartes en plus des deux commandants, partenaire hors du deck", () => {
    const solo = buildCommander(all, T.name);
    const duo = buildCommander(all, T.name, null, { partner: K.name });
    expect(solo.partner).toBeUndefined();
    expect(duo.partner.name).toBe(K.name);
    expect(duo.identity).toEqual(["W", "U", "B", "R"]);
    expect(duo.total).toBe(98);
    expect(duo.cards.some(c => c.name === K.name || c.name === T.name)).toBe(false);
    expect(buildCommander(all, T.name, null, { partner: alone.name }).partner).toBeUndefined(); // association impossible : ignorée
  });

  it("meilleur partenaire automatique ; seul s'il n'y en a pas", () => {
    expect(bestPartner(all, T.name).partner.name).toBe(K.name);
    expect(bestPartner(col.concat(T), T.name).partner).toBeUndefined();
  });

  it("decklist importée ou exportée avec deux commandants", () => {
    const deck = deckFromList([{ card: T, count: 1 }, { card: K, count: 1 }, { card: { ...col[0] }, count: 1 }], { commander: T, partner: K, owned: { [T.name]: 1 } });
    expect([deck.commander.name, deck.partner.name, deck.total]).toEqual([T.name, K.name, 1]);
    expect(deck.identity).toEqual(["W", "U", "B", "R"]);
    expect(deck.to_buy[0]).toMatchObject({ name: K.name }); // partenaire pas possédé : à acheter
    expect(formatDecklist(deck).split("\n").slice(0, 4)).toEqual(["Commander", `1 ${T.name}`, `1 ${K.name}`, ""]);
  });
});
import { basicsSplit } from "../../src/core/cards.js";

describe("terrains de base", () => {
  it("jamais plus que demandé, même si une couleur n'a aucun symbole", () => {
    const sum = o => Object.values(o).reduce((a, b) => a + b, 0);
    expect(sum(basicsSplit(10, { W: 5, U: 0, B: 0, R: 1 }, ["W", "U", "B", "R"]))).toBe(10);
    expect(basicsSplit(10, { W: 5, U: 3, B: 2, R: 1 }, ["W", "U", "B", "R"])).toEqual({ Plains: 4, Island: 3, Swamp: 2, Mountain: 1 }); // inchangé
  });
});
describe("variantes « Partner—… » (textes officiels actuels)", () => {
  const card = (name, line, ci) => ({ name, type_line: "Legendary Creature — Human", oracle_text: `${line} (You can have two commanders if both have this ability.)`, keywords: ["Partner"], color_identity: ci, ...legal });
  const cecily = card("Cecily, Haunted Mage", "Partner—Friends forever", ["U", "B", "R"]), elmar = card("Elmar, Ulvenwald Informant", "Partner—Friends forever", ["G", "R"]);
  const abby = card("Abby, Merciless Soldier", "Partner—Survivors", ["G", "R"]), ellie = card("Ellie, Vengeful Hunter", "Partner—Survivors", ["B", "R"]);

  it("même groupe seulement ; jamais avec un Partner simple", () => {
    expect(partnerKind(cecily)).toEqual({ kind: "group", group: "friends forever" });
    expect(canPair(cecily, elmar)).toBe(true);
    expect(canPair(abby, ellie)).toBe(true);
    expect(canPair(cecily, abby)).toBe(false);
    expect(canPair(cecily, tymna)).toBe(false);
    expect(canPair(friend("Old wording"), cecily)).toBe(true); // ancien texte « Friends forever » (cache) = même capacité
  });
});
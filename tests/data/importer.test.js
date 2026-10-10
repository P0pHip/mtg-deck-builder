import { describe, expect, it } from "vitest";
import { parseCSV, parseCollection } from "../../src/data/scryfall/importer.js";

describe("parseCSV", () => {
  it("gère les guillemets, les virgules dans les noms et les fins de ligne Windows", () => {
    const rows = parseCSV('quantity,name,set\r\n1,"Atraxa, Praetors\' Voice",c16\r\n2,"Say ""hi""",m10\r\n');
    expect(rows).toEqual([
      { quantity: "1", name: "Atraxa, Praetors' Voice", set: "c16" },
      { quantity: "2", name: 'Say "hi"', set: "m10" },
    ]);
  });
  it("accepte le point-virgule comme séparateur", () => {
    expect(parseCSV("name;qty\nSol Ring;3")).toEqual([{ name: "Sol Ring", qty: "3" }]);
  });
});

describe("parseCollection", () => {
  const row = (name, quantity, set = "", extra = {}) => ({ name, quantity, set, number: "", lang: "", foil: false, condition: "NM", ...extra });

  it("reconnaît les en-têtes ManaBox (« Set code », « Quantity ») ; exemplaires identiques fusionnés, différents séparés", () => {
    const csv = "Name,Set code,Quantity,Foil\nSol Ring,CMM,1,false\nsol ring,CMR,2,true\nLightning Bolt,M10,4,false\nLightning Bolt,M10,1,false\n";
    expect(parseCollection("manabox.csv", csv)).toEqual([
      row("Sol Ring", 1, "cmm"), row("sol ring", 2, "cmr", { foil: true }), row("Lightning Bolt", 5, "m10"),
    ]);
  });
  it("lit le numéro, la langue (nom ou code), la finition et l'état (export Moxfield)", () => {
    const csv = '"Count","Name","Edition","Condition","Language","Foil","Collector Number"\n'
      + '"1","Sol Ring","c21","Near Mint","French","foil","0263"\n"2","Opt","eld","Lightly Played","JA","",""\n"1","Opt","eld","Excellent","ja","etched",""\n';
    expect(parseCollection("moxfield.csv", csv)).toEqual([
      row("Sol Ring", 1, "c21", { number: "263", lang: "fr", foil: true }),
      row("Opt", 2, "eld", { lang: "ja", condition: "LP" }),
      row("Opt", 1, "eld", { lang: "ja", condition: "LP", foil: true }),
    ]);
  });
  it("lit un JSON (tableau ou objet {cards: [...]}) et le BOM UTF-8", () => {
    expect(parseCollection("c.json", '﻿[{"name":"Opt","count":2,"foil":true}]')).toEqual([row("Opt", 2, "", { foil: true })]);
    expect(parseCollection("c.json", '{"cards":[{"card":"Opt"}]}')).toEqual([row("Opt", 1)]);
  });
  it("ignore les lignes sans nom", () => {
    expect(parseCollection("c.csv", "name,quantity\n,3\nOpt,1")).toEqual([row("Opt", 1)]);
  });
});

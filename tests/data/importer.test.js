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
  it("reconnaît les en-têtes ManaBox (« Set code », « Quantity ») et fusionne les doublons", () => {
    const csv = "Name,Set code,Quantity,Foil\nSol Ring,CMM,1,false\nsol ring,CMR,2,true\nLightning Bolt,M10,4,false\n";
    expect(parseCollection("manabox.csv", csv)).toEqual([
      { name: "Sol Ring", quantity: 3, set: "cmm" },
      { name: "Lightning Bolt", quantity: 4, set: "m10" },
    ]);
  });
  it("lit un JSON (tableau ou objet {cards: [...]}) et le BOM UTF-8", () => {
    expect(parseCollection("c.json", '﻿[{"name":"Opt","count":2}]')).toEqual([{ name: "Opt", quantity: 2, set: "" }]);
    expect(parseCollection("c.json", '{"cards":[{"card":"Opt"}]}')).toEqual([{ name: "Opt", quantity: 1, set: "" }]);
  });
  it("ignore les lignes sans nom", () => {
    expect(parseCollection("c.csv", "name,quantity\n,3\nOpt,1")).toEqual([{ name: "Opt", quantity: 1, set: "" }]);
  });
});

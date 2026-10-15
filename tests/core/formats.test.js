import { describe, expect, it } from "vitest";
import { formatCheck } from "../../src/core/formats.js";

const L = (standard, pioneer, modern, extra = {}) => ({ standard, pioneer, modern, legacy: "legal", vintage: "legal", commander: "legal", pauper: "not_legal", ...extra });
const legal = {
  "Rotated Card": L("not_legal", "legal", "legal"),
  "Fresh Card": L("legal", "legal", "legal"),
  "Old Card": L("not_legal", "not_legal", "legal"),
  "Banned Everywhere": L("banned", "banned", "banned", { legacy: "banned", vintage: "restricted", commander: "banned" }),
};
const deck = (format, ...names) => ({ format, cards: names.map(name => ({ name, count: 1 })) });

describe("formats des decks enregistrés", () => {
  it("tout est légal : rien à signaler (terrains de base et cartes inconnues ignorés)", () => {
    expect(formatCheck(deck("standard", "Fresh Card", "Forest", "Unknown"), legal)).toBeNull();
  });
  it("rotation Standard : le deck passe au premier format où tout est légal", () => {
    expect(formatCheck(deck("standard", "Fresh Card", "Rotated Card"), legal)).toEqual({ illegal: [{ name: "Rotated Card", status: "not_legal" }], newFormat: "pioneer" });
    expect(formatCheck(deck("standard", "Rotated Card", "Old Card"), legal).newFormat).toBe("modern");
    expect(formatCheck(deck("modern", "Banned Everywhere"), legal)).toEqual({ illegal: [{ name: "Banned Everywhere", status: "banned" }], newFormat: "vintage" }); // restreinte en Vintage
  });
  it("Commander : carte bannie signalée, pas de changement de format (commandant compris)", () => {
    const d = { ...deck("commander", "Fresh Card"), commander: { name: "Banned Everywhere" } };
    expect(formatCheck(d, legal)).toEqual({ illegal: [{ name: "Banned Everywhere", status: "banned" }], newFormat: null });
  });
});
import { describe, expect, it } from "vitest";
import { parseVisionAnswer } from "../../src/ai/cardVision.js";

describe("réponse de l'IA sur une photo de carte", () => {
  it("JSON complet (même entouré de texte ou de ```json)", () => {
    expect(parseVisionAnswer('```json\n{"name":"Lightning Bolt","set":"M21","number":"0123"}\n```')).toEqual({ name: "Lightning Bolt", set: "m21", number: "123" });
  });
  it("champs vides ou code d'extension farfelu", () => {
    expect(parseVisionAnswer('{"name":"Fureteur des secrets","set":"","number":""}')).toEqual({ name: "Fureteur des secrets", set: "", number: "" });
    expect(parseVisionAnswer('{"name":"Sol Ring","set":"inconnu","number":"?"}')).toEqual({ name: "Sol Ring", set: "", number: "" });
  });
  it("sans JSON : la première ligne sert de nom ; rien d'exploitable → null", () => {
    expect(parseVisionAnswer("Nom : Snapcaster Mage\nC'est une créature.")).toEqual({ name: "Snapcaster Mage", set: "", number: "" });
    expect(parseVisionAnswer("")).toBeNull();
    expect(parseVisionAnswer('{"name":"","set":"","number":""}')).toBeNull();
  });
});

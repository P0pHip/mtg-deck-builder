import { describe, expect, it } from "vitest";
import { cardQuery } from "../../src/ai/cardQuery.js";
import { parseChanges, stripThinking } from "../../src/ai/prompts.js";

const deck = { format: "modern", identity: ["B", "R"], cards: [] };

describe("demande du joueur → recherche Scryfall", () => {
  it("« ajoute des soldats blancs » → type soldat, blanc, légal en Modern", () => {
    const q = cardQuery("ajoute des soldtats blanc", deck) || cardQuery("ajoute des soldats blancs", deck);
    expect(q.query).toBe("t:soldier c>=W f:modern -t:basic game:paper");
    expect(q.criteria).toEqual(["Soldier", "W"]);
  });
  it("sans couleur précisée, reste dans les couleurs du deck ; les thèmes deviennent des critères", () => {
    expect(cardQuery("trouve-moi des cartes qui créent des jetons sang", deck).query)
      .toBe('o:"token" o:"blood" id<=BR f:modern -t:basic game:paper');
  });
  it("pas de recherche sans demande ni critère concret", () => {
    expect(cardQuery("que penses-tu de mon deck ?", deck)).toBe(null);
    expect(cardQuery("cherche dans l'api fumier", deck)).toBe(null);
    expect(cardQuery("ajoute des cartes qui font des trésors", deck).query).toBe('o:"treasure" id<=BR f:modern -t:basic game:paper');
  });
});

describe("réponses du modèle nettoyées", () => {
  it("un échange « N/A » n'est pas une proposition", () => {
    expect(parseChanges('Rien.\n```json\n{"remove":[{"name":"N/A"}],"add":[{"name":"N/A"}]}\n```').changes).toBe(null);
  });
  it("les fausses lignes « Résultat : » écrites par le modèle sont retirées", () => {
    expect(stripThinking("Voici.\nRésultat : Aucune carte trouvée")).toBe("Voici.");
  });
});

import { describe, expect, it } from "vitest";
import { setFetch } from "../../src/data/scryfall/client.js";
import { rulings } from "../../src/data/scryfall/index.js";

const json = body => ({ ok: true, status: 200, json: async () => body });

describe("règles officielles d'une carte", () => {
  it("cherche la carte par sa face avant, puis ses règles ; ensuite depuis le cache", async () => {
    const calls = [];
    setFetch(async url => {
      calls.push(url);
      const u = new URL(url);
      if (u.pathname === "/cards/named") return json({ name: "Delver of Secrets // Insectile Aberration", rulings_uri: "https://api.scryfall.com/cards/abc/rulings" });
      if (u.pathname === "/cards/abc/rulings") return json({ data: [{ source: "wotc", published_at: "2021-09-24", comment: "Look at the top card." }] });
      return { ok: false, status: 404 };
    });
    const list = await rulings("Delver of Secrets // Insectile Aberration");
    expect(list).toEqual([{ date: "2021-09-24", text: "Look at the top card.", source: "wotc" }]);
    expect(new URL(calls[0]).searchParams.get("exact")).toBe("Delver of Secrets");
    await rulings("Delver of Secrets");
    expect(calls).toHaveLength(2); // cache
  });

  it("carte sans règle → liste vide", async () => {
    setFetch(async url => (new URL(url).pathname === "/cards/named" ? json({ name: "Plain Card", rulings_uri: "https://api.scryfall.com/cards/p/rulings" }) : json({ data: [] })));
    expect(await rulings("Plain Card")).toEqual([]);
  });
});

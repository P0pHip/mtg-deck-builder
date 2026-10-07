"""MTG Deck Builder — serveur Flask local.  Lancer : python app.py  puis http://localhost:5000"""
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

import ai
import builder
import decks
import scryfall

BASE = Path(__file__).parent
app = Flask(__name__, static_folder="static")


def load_collection():
    return decks.load_collection()


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.post("/api/import")
def import_collection():
    f = request.files.get("file")
    if f:
        entries = scryfall.parse_collection(f.filename, f.read())
    else:  # bouton "charger l'exemple"
        sample = BASE / "data" / "collection_exemple.csv"
        entries = scryfall.parse_collection(sample.name, sample.read_bytes())
    try:
        collection, not_found = scryfall.enrich(entries)
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": f"Erreur Scryfall : {e}"}), 502
    decks.save_collection(collection)
    return jsonify({"count": len(collection), "cards": sum(c["quantity"] for c in collection),
                    "not_found": not_found})


@app.get("/api/collection")
def get_collection():
    col, res = load_collection(), decks.reservations()
    for c in col:
        c["category"] = builder.category(c)
        c["reserved"] = res.get(c["name"], [])
    return jsonify(col)


@app.get("/api/commanders")
def get_commanders():
    res = decks.reservations()
    return jsonify([{"name": c["name"], "identity": c["color_identity"], "image_small": c.get("image_small"),
                     "fr": c.get("fr"), "reserved": [r["name"] for r in res.get(c["name"], [])]}
                    for c in builder.commanders(load_collection())])


def _make_deck(pool, body):
    fmt = body.get("format", "commander")
    wish = builder.wish_profile(body.get("wish"))
    if fmt == "commander":
        cmd = body.get("commander")
        if cmd:
            if not any(c["name"] == cmd for c in pool):
                return None
            return builder.build_commander(pool, cmd, wish)
        return builder.best_commander(pool, wish)
    return builder.build_sixty(pool, fmt, body.get("colors") or None, wish)


@app.post("/api/build")
def build():
    """Construit avec les cartes libres. Si emprunter des cartes à des decks enregistrés
    donnerait un deck nettement meilleur (ou complet), on le signale dans "suggestion"."""
    body = request.get_json(force=True)
    col = load_collection()
    if not col:
        return jsonify({"error": "Importe d'abord ta collection."}), 400
    deck_id, use_reserved = body.get("deck_id"), body.get("use_reserved", False)
    free = decks.available(col, deck_id)

    deck = _make_deck(col if use_reserved else free, body)
    suggestion = None
    if not use_reserved and decks.reservations(deck_id):
        full = _make_deck(col, body)
        better = full and (not deck or full["total"] > deck["total"] or full["score"] > deck["score"] + 0.02)
        if better:
            borrow = decks.borrow_report(full, col, deck_id)
            if borrow:
                suggestion = {
                    "cards": borrow,
                    "decks": sorted({(d["id"], d["name"]) for b in borrow for d in b["decks"]}),
                    "score_gain": round((full["score"] - (deck["score"] if deck else 0)) * 100),
                    "total_gain": full["total"] - (deck["total"] if deck else 0),
                }
    if not deck:
        return jsonify({"error": "Impossible de construire ce deck avec tes cartes libres.",
                        "suggestion": suggestion}), 400
    if body.get("include_external"):
        deck = _with_external(deck, col if use_reserved else free, body)
    deck["borrowed"] = decks.borrow_report(deck, col, deck_id) if use_reserved else []
    deck["suggestion"] = suggestion
    return jsonify(deck)


def _with_external(deck, owned_pool, body):
    """Reconstruit le deck en autorisant des cartes hors collection (top EDHREC du format/couleurs).
    Le commandant et les couleurs restent ceux trouvés avec la collection."""
    fmt = deck["format"]
    try:
        external = scryfall.top_cards(fmt, deck["identity"])
    except Exception as e:  # noqa: BLE001
        deck.setdefault("warnings", []).append(f"Cartes hors collection indisponibles (Scryfall) : {e}")
        return deck
    cap = 1 if fmt == "commander" else 4
    pool = builder.merge_external(owned_pool, external, cap)
    fixed = {**body, "colors": deck["identity"]}
    if deck.get("commander"):
        fixed["commander"] = deck["commander"]["name"]
    new = _make_deck(pool, fixed) or deck
    # noms / images FR pour les cartes à acheter
    ext = {c["name"]: c for c in external}
    need_fr = [ext[c["name"]] for c in new["cards"] if c.get("missing") and c["name"] in ext and "fr" not in ext[c["name"]]]
    scryfall.french_for(need_fr)
    for c in new["cards"]:
        if c["name"] in ext and ext[c["name"]].get("fr") and not c.get("fr"):
            c["fr"] = ext[c["name"]]["fr"]
    new["external"] = True
    return new


@app.post("/api/explain")
def explain():
    body = request.get_json(force=True)
    deck, lang = body.get("deck", body), body.get("lang", "fr")
    free = decks.available(load_collection(), body.get("deck_id"))
    text = ai.explain(deck, free, lang)
    text = ai.localize(text, decks.load_collection(), lang)  # toute la collection, même les cartes rangées
    return jsonify({"text": text, "model": ai.OLLAMA_MODEL})


@app.post("/api/chat")
def chat():
    body = request.get_json(force=True)
    deck, history, lang = body["deck"], body.get("history", []), body.get("lang", "fr")
    col = load_collection()
    # le deck lui-même ne se bloque pas ses propres cartes : on rend ses cartes "libres" pour le calcul
    pool = col if body.get("use_reserved") else decks.available(col, body.get("deck_id"))
    text, changes = ai.chat(deck, builder.legal_pool(pool, deck), history, lang, everything=col)
    log = []
    if changes:
        deck, log = builder.apply_changes(deck, pool, changes.get("remove"), changes.get("add"))
    return jsonify({"text": text, "deck": deck, "log": log})


# ------------------------------------------------------------ édition collection
@app.post("/api/collection/qty")
def collection_qty():
    """+/- sur une carte de la collection."""
    body = request.get_json(force=True)
    name, delta = body["name"], int(body.get("delta", 0))
    q = decks.set_quantity(name, decks.get_quantity(name) + delta)
    reserved = decks.reserved_count(name)
    warn = (f"Attention : {reserved} exemplaire(s) de {name} sont dans tes decks enregistrés, "
            f"mais tu n'en as plus que {q}.") if q is not None and reserved > q else None
    return jsonify({"name": name, "quantity": q or 0, "warning": warn})


@app.get("/api/search")
def search_cards():
    q = request.args.get("q", "").strip()
    if len(q) < 2:
        return jsonify([])
    owned = {c["name"]: c["quantity"] for c in load_collection()}
    res = scryfall.search(q, request.args.get("lang", "fr"))
    for r in res:
        r["owned"] = owned.get(r["name"], 0)
    return jsonify(res)


@app.post("/api/collection/add")
def collection_add():
    """Ajout manuel : récupère la carte sur Scryfall (EN + FR) puis l'ajoute / l'incrémente."""
    body = request.get_json(force=True)
    name, qty = body["name"], max(1, int(body.get("quantity", 1)))
    current = decks.get_quantity(name)
    if current:
        decks.set_quantity(name, current + qty)
        return jsonify({"name": name, "quantity": current + qty})
    try:
        cards, not_found = scryfall.enrich([{"name": name, "quantity": qty, "set": body.get("set", "")}])
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": f"Erreur Scryfall : {e}"}), 502
    if not cards:
        return jsonify({"error": f"Carte introuvable : {name}"}), 404
    decks.set_quantity(cards[0]["name"], qty, cards[0])
    return jsonify({"name": cards[0]["name"], "quantity": qty})


# ------------------------------------------------------------ édition manuelle du deck
@app.post("/api/deck/edit")
def deck_edit():
    body = request.get_json(force=True)
    col = load_collection()
    pool = col if body.get("use_reserved") else decks.available(col, body.get("deck_id"))
    deck, log = builder.apply_changes(body["deck"], pool, body.get("remove"), body.get("add"))
    return jsonify({"deck": deck, "log": log})


@app.post("/api/deck/pool")
def deck_pool():
    """Cartes qu'on peut encore ajouter à ce deck (possédées, libres, légales, couleurs OK)."""
    body = request.get_json(force=True)
    col = load_collection()
    pool = col if body.get("use_reserved") else decks.available(col, body.get("deck_id"))
    in_deck = {c["name"]: c["count"] for c in body["deck"]["cards"]}
    cap = 1 if body["deck"]["format"] == "commander" else 4
    out = [{"name": c["name"], "fr": c.get("fr"), "type_line": c["type_line"], "mana_cost": c["mana_cost"],
            "oracle_text": c["oracle_text"], "cmc": c["cmc"], "image": c.get("image"), "image_small": c.get("image_small"),
            "image_back": c.get("image_back"), "edhrec_rank": c.get("edhrec_rank"),
            "category": builder.category(c), "free": min(c["quantity"], cap) - in_deck.get(c["name"], 0)}
           for c in builder.legal_pool(pool, body["deck"])]
    out.sort(key=lambda o: o["edhrec_rank"] or 99999)
    return jsonify([o for o in out if o["free"] > 0])


# ------------------------------------------------------------ export vers l'appli mobile
@app.get("/api/export")
def export_backup():
    """Sauvegarde au format de l'appli mobile (onglet Plus > Restaurer une sauvegarde)."""
    import time
    from flask import Response
    import json as _json
    data = {"app": "mtg-deck-builder", "version": 1, "exported_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "collection": load_collection(), "decks": decks.load()}
    return Response(_json.dumps(data, ensure_ascii=False), mimetype="application/json",
                    headers={"Content-Disposition": f"attachment; filename=mtg-sauvegarde-{time.strftime('%Y-%m-%d')}.json"})


# ------------------------------------------------------------ decks enregistrés
@app.get("/api/decks")
def list_decks():
    out = []
    col = load_collection()
    for d in decks.load():
        out.append({**d, "borrowed": decks.borrow_report(d["deck"], col, d["id"])})
    return jsonify(out)


@app.post("/api/decks")
def save_deck():
    body = request.get_json(force=True)
    deck = {k: v for k, v in body["deck"].items() if k != "suggestion"}
    entry = decks.save(body.get("name") or "Deck sans nom", deck, body.get("id"))
    return jsonify(entry)


@app.delete("/api/decks/<deck_id>")
def break_deck(deck_id):
    removed = decks.delete(deck_id)
    if not removed:
        return jsonify({"error": "Deck introuvable"}), 404
    n = sum(decks.deck_cards(removed["deck"]).values())
    return jsonify({"ok": True, "name": removed["name"], "freed": n})


if __name__ == "__main__":
    print("Ouvre http://localhost:5000")
    app.run(host="127.0.0.1", port=5000, debug=False)

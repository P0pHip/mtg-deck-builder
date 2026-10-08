"""Base SQLite (data/mtg.db) : collection + decks enregistrés + cartes réservées.

Tables :
  collection(name PK, quantity, set_code, data JSON)        -- cartes possédées, données Scryfall
  decks(id PK, name, format, saved_at, data JSON)           -- deck complet (pour le réafficher)
  deck_cards(deck_id, name, count)                          -- cartes utilisées par chaque deck (réservations)
"""
import json
import sqlite3
import time
import uuid
from collections import Counter
from pathlib import Path

from builder import BASIC_NAMES

DB_FILE = Path(__file__).parent / "data" / "mtg.db"
OLD_COLLECTION = Path(__file__).parent / "data" / "collection.json"

SCHEMA = """
CREATE TABLE IF NOT EXISTS collection (
  name TEXT PRIMARY KEY, quantity INTEGER NOT NULL, set_code TEXT, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS decks (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, format TEXT, saved_at TEXT, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS deck_cards (
  deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  name TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (deck_id, name));
CREATE INDEX IF NOT EXISTS idx_deck_cards_name ON deck_cards(name);
"""


def connect():
    DB_FILE.parent.mkdir(exist_ok=True)
    con = sqlite3.connect(DB_FILE)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    con.executescript(SCHEMA)
    return con


# ----------------------------------------------------------------- collection
def save_collection(cards):
    with connect() as con:
        con.execute("DELETE FROM collection")
        con.executemany("INSERT INTO collection(name, quantity, set_code, data) VALUES (?,?,?,?)",
                        [(c["name"], c["quantity"], c.get("set"), json.dumps(c, ensure_ascii=False)) for c in cards])


def load_collection():
    with connect() as con:
        rows = con.execute("SELECT quantity, data FROM collection").fetchall()
        if not rows and OLD_COLLECTION.exists():  # migration depuis l'ancien collection.json
            save_collection(json.loads(OLD_COLLECTION.read_text(encoding="utf-8")))
            rows = con.execute("SELECT quantity, data FROM collection").fetchall()
    return [{**json.loads(r["data"]), "quantity": r["quantity"]} for r in rows]


def set_quantity(name, quantity, card=None):
    """Fixe la quantité d'une carte (0 = retirée). `card` = données Scryfall si la carte est nouvelle."""
    with connect() as con:
        if quantity <= 0:
            con.execute("DELETE FROM collection WHERE name = ?", (name,))
            return 0
        row = con.execute("SELECT 1 FROM collection WHERE name = ?", (name,)).fetchone()
        if row:
            con.execute("UPDATE collection SET quantity = ? WHERE name = ?", (quantity, name))
        elif card:
            con.execute("INSERT INTO collection(name, quantity, set_code, data) VALUES (?,?,?,?)",
                        (name, quantity, card.get("set"), json.dumps(card, ensure_ascii=False)))
        else:
            return None
    return quantity


def get_quantity(name):
    with connect() as con:
        row = con.execute("SELECT quantity FROM collection WHERE name = ?", (name,)).fetchone()
    return row["quantity"] if row else 0


def reserved_count(name):
    with connect() as con:
        row = con.execute("SELECT COALESCE(SUM(count),0) AS n FROM deck_cards WHERE name = ?", (name,)).fetchone()
    return row["n"]


# ----------------------------------------------------------------------- decks
def deck_cards(deck):
    """Compte {nom: exemplaires} d'un deck, commandant inclus, terrains de base exclus."""
    c = Counter()
    for card in deck["cards"]:
        if card["name"] not in BASIC_NAMES:
            n = card["count"] - (card.get("missing") or 0)  # on ne réserve que les exemplaires possédés
            if n > 0:
                c[card["name"]] += n
    if deck.get("commander"):
        c[deck["commander"]["name"]] += 1
    return c


def load():
    with connect() as con:
        rows = con.execute("SELECT * FROM decks ORDER BY saved_at DESC").fetchall()
    return [{"id": r["id"], "name": r["name"], "format": r["format"], "saved_at": r["saved_at"],
             "deck": json.loads(r["data"])} for r in rows]


def save(name, deck, deck_id=None):
    deck_id = deck_id or uuid.uuid4().hex[:8]
    saved_at = time.strftime("%Y-%m-%d %H:%M")
    with connect() as con:
        con.execute("INSERT OR REPLACE INTO decks(id, name, format, saved_at, data) VALUES (?,?,?,?,?)",
                    (deck_id, name, deck["format"], saved_at, json.dumps(deck, ensure_ascii=False)))
        con.execute("DELETE FROM deck_cards WHERE deck_id = ?", (deck_id,))
        con.executemany("INSERT INTO deck_cards(deck_id, name, count) VALUES (?,?,?)",
                        [(deck_id, n, c) for n, c in deck_cards(deck).items()])
    return {"id": deck_id, "name": name, "format": deck["format"], "saved_at": saved_at, "deck": deck}


def delete(deck_id):
    """Éclate un deck : il disparaît et ses cartes redeviennent libres."""
    with connect() as con:
        row = con.execute("SELECT * FROM decks WHERE id = ?", (deck_id,)).fetchone()
        if not row:
            return None
        con.execute("DELETE FROM decks WHERE id = ?", (deck_id,))  # deck_cards supprimé en cascade
    return {"id": row["id"], "name": row["name"], "deck": json.loads(row["data"])}


def reservations(exclude_id=None):
    """{nom: [{id, name, count}]} : dans quels decks enregistrés chaque carte est utilisée."""
    with connect() as con:
        rows = con.execute("""SELECT dc.name AS card, dc.count, d.id, d.name AS deck
                              FROM deck_cards dc JOIN decks d ON d.id = dc.deck_id
                              WHERE d.id IS NOT ?""", (exclude_id,)).fetchall()
    res = {}
    for r in rows:
        res.setdefault(r["card"], []).append({"id": r["id"], "name": r["deck"], "count": r["count"]})
    return res


def available(collection, exclude_id=None):
    """Collection moins les cartes déjà placées dans des decks enregistrés."""
    res = reservations(exclude_id)
    out = []
    for c in collection:
        free = c["quantity"] - sum(r["count"] for r in res.get(c["name"], []))
        if free > 0:
            out.append({**c, "quantity": free})
    return out


def borrow_report(deck, collection, exclude_id=None):
    """Cartes du deck qui dépassent ce qui est libre → [{name, count, decks:[...]}]."""
    res = reservations(exclude_id)
    free = {c["name"]: c["quantity"] for c in available(collection, exclude_id)}
    out = []
    for name, n in deck_cards(deck).items():
        missing = n - free.get(name, 0)
        if missing > 0 and name in res:
            out.append({"name": name, "count": missing, "decks": res[name]})
    return out

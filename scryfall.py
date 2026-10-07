"""Import d'une collection (CSV/JSON) et enrichissement via l'API Scryfall."""
import csv
import io
import json
import time
from pathlib import Path

import requests

HEADERS = {"User-Agent": "MtgDeckBuilder/0.1", "Accept": "application/json"}
COLLECTION_URL = "https://api.scryfall.com/cards/collection"
SEARCH_URL = "https://api.scryfall.com/cards/search"
CACHE_FILE = Path(__file__).parent / "data" / "scryfall_cache.json"

NAME_KEYS = ("name", "card", "card_name", "nom")
QTY_KEYS = ("quantity", "qty", "count", "quantite", "quantité")
SET_KEYS = ("set_code", "set", "edition_code", "edition", "extension")


def _pick(row, keys, default=None):
    low = {k.strip().lower().replace(" ", "_"): v for k, v in row.items() if k}
    for k in keys:
        if k in low and str(low[k]).strip():
            return str(low[k]).strip()
    return default


def parse_collection(filename: str, raw: bytes):
    """Retourne une liste [{name, quantity, set}] depuis un CSV ou un JSON."""
    text = raw.decode("utf-8-sig")
    if filename.lower().endswith(".json"):
        data = json.loads(text)
        if isinstance(data, dict):
            data = data.get("cards") or data.get("data") or list(data.values())
        rows = data
    else:
        rows = list(csv.DictReader(io.StringIO(text)))

    merged = {}
    for row in rows:
        name = _pick(row, NAME_KEYS)
        if not name:
            continue
        qty = int(float(_pick(row, QTY_KEYS, "1")))
        set_code = (_pick(row, SET_KEYS, "") or "").lower()
        key = name.lower()
        if key in merged:
            merged[key]["quantity"] += qty
        else:
            merged[key] = {"name": name, "quantity": qty, "set": set_code}
    return list(merged.values())


def _load_cache():
    if CACHE_FILE.exists():
        return json.loads(CACHE_FILE.read_text(encoding="utf-8"))
    return {}


def _save_cache(cache):
    CACHE_FILE.parent.mkdir(exist_ok=True)
    CACHE_FILE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")


def _back_image(card):
    """Image de la face arrière (cartes transformables / MDFC), sinon None."""
    faces = card.get("card_faces") or []
    if card.get("image_uris") or len(faces) < 2:
        return None  # carte simple, split ou aventure : une seule image
    return faces[1].get("image_uris", {}).get("normal")


def _slim(card):
    """Garde uniquement les champs utiles au moteur de deck."""
    faces = card.get("card_faces") or []
    oracle = card.get("oracle_text") or " // ".join(f.get("oracle_text", "") for f in faces)
    mana_cost = card.get("mana_cost") or (faces[0].get("mana_cost", "") if faces else "")
    images = card.get("image_uris") or (faces[0].get("image_uris", {}) if faces else {})
    return {
        "name": card["name"],
        "oracle_id": card.get("oracle_id") or (faces[0].get("oracle_id") if faces else None),
        "cmc": card.get("cmc", 0),
        "mana_cost": mana_cost,
        "type_line": card.get("type_line", ""),
        "oracle_text": oracle,
        "colors": card.get("colors") or (faces[0].get("colors", []) if faces else []),
        "color_identity": card.get("color_identity", []),
        "keywords": card.get("keywords", []),
        "legalities": card.get("legalities", {}),
        "edhrec_rank": card.get("edhrec_rank"),
        "price_eur": float(card["prices"]["eur"]) if card.get("prices", {}).get("eur") else None,
        "image": images.get("normal"),
        "image_small": images.get("small"),
        "image_back": _back_image(card),
        "scryfall_uri": card.get("scryfall_uri"),
    }


def _post_batch(identifiers):
    resp = requests.post(COLLECTION_URL, json={"identifiers": identifiers}, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    time.sleep(0.12)  # Scryfall demande ~10 requêtes/s max
    return resp.json()


def _match(found, wanted_name):
    w = wanted_name.lower()
    for c in found:
        n = c["name"].lower()
        if n == w or n.split(" // ")[0] == w:
            return c
    return None


def _french(card):
    """Extrait nom / texte / type / image de l'impression française."""
    faces = card.get("card_faces") or []
    images = card.get("image_uris") or (faces[0].get("image_uris", {}) if faces else {})
    if faces:
        name = " // ".join(f.get("printed_name") or f.get("name", "") for f in faces)
        text = " // ".join(f.get("printed_text") or f.get("oracle_text", "") for f in faces)
        type_line = " // ".join(f.get("printed_type_line") or f.get("type_line", "") for f in faces)
    else:
        name = card.get("printed_name") or card["name"]
        text = card.get("printed_text") or card.get("oracle_text", "")
        type_line = card.get("printed_type_line") or card.get("type_line", "")
    return {"name": name, "text": text, "type_line": type_line,
            "image": images.get("normal"), "image_small": images.get("small"), "image_back": _back_image(card)}


def add_french(cache, keys):
    """Récupère les versions FR par paquets de 20 (recherche Scryfall par oracle_id)."""
    todo = [k for k in keys if k in cache and "fr" not in cache[k] and cache[k].get("oracle_id")]
    for i in range(0, len(todo), 20):
        batch = todo[i:i + 20]
        q = "lang:fr (" + " or ".join(f"oracleid:{cache[k]['oracle_id']}" for k in batch) + ")"
        url, found = SEARCH_URL, {}
        params = {"q": q, "unique": "cards", "include_multilingual": "true"}
        while url:
            r = requests.get(url, params=params, headers=HEADERS, timeout=30)
            time.sleep(0.12)
            if r.status_code == 404:  # aucune impression FR dans ce paquet
                break
            r.raise_for_status()
            j = r.json()
            for c in j["data"]:
                found[c.get("oracle_id") or c["card_faces"][0].get("oracle_id")] = _french(c)
            url, params = (j.get("next_page"), None) if j.get("has_more") else (None, None)
        for k in batch:
            cache[k]["fr"] = found.get(cache[k]["oracle_id"])  # None = pas d'impression FR


def enrich(entries, progress=None):
    """Ajoute les données Scryfall (EN + FR) à chaque entrée. Utilise un cache local."""
    cache = _load_cache()
    todo = [e for e in entries if e["name"].lower() not in cache
            or "image_back" not in cache[e["name"].lower()]]

    for i in range(0, len(todo), 75):
        batch = todo[i:i + 75]
        ids = [{"name": e["name"], "set": e["set"]} if e["set"] else {"name": e["name"]} for e in batch]
        found = _post_batch(ids)["data"]
        retry = []
        for e in batch:
            c = _match(found, e["name"])
            if c:
                cache[e["name"].lower()] = _slim(c)
            elif e["set"]:
                retry.append(e)  # mauvais code d'extension → on réessaie avec le nom seul
        if retry:
            found2 = _post_batch([{"name": e["name"]} for e in retry])["data"]
            for e in retry:
                c = _match(found2, e["name"])
                if c:
                    cache[e["name"].lower()] = _slim(c)
        if progress:
            progress(min(i + 75, len(todo)), len(todo))

    try:
        add_french(cache, [e["name"].lower() for e in entries])
    except requests.RequestException as ex:  # le FR est un bonus : on ne bloque pas l'import
        print("Traduction FR incomplete :", ex)
    _save_cache(cache)

    collection, not_found = [], []
    for e in entries:
        data = cache.get(e["name"].lower())
        if data:
            collection.append({**data, "quantity": e["quantity"], "set": e["set"]})
        else:
            not_found.append(e["name"])
    return collection, not_found


def search(text, lang="fr", limit=16):
    """Recherche de cartes pour l'ajout manuel. En FR, cherche aussi les noms imprimés français."""
    results, seen = [], set()

    def run(q, multilingual):
        params = {"q": q, "unique": "cards", "order": "edhrec"}
        if multilingual:
            params["include_multilingual"] = "true"
        r = requests.get(SEARCH_URL, params=params, headers=HEADERS, timeout=20)
        time.sleep(0.1)
        return [] if r.status_code == 404 else (r.raise_for_status() or r.json()["data"])

    queries = ([(f'{text} lang:fr', True)] if lang == "fr" else []) + [(text, False)]
    for q, ml in queries:
        try:
            cards = run(q, ml)
        except requests.RequestException:
            continue
        for c in cards:
            en_name = c["name"]
            if en_name in seen:
                continue
            seen.add(en_name)
            faces = c.get("card_faces") or []
            img = c.get("image_uris") or (faces[0].get("image_uris", {}) if faces else {})
            results.append({
                "name": en_name,
                "printed_name": c.get("printed_name") if c.get("lang") != "en" else None,
                "type_line": c.get("printed_type_line") or c.get("type_line", ""),
                "mana_cost": c.get("mana_cost") or (faces[0].get("mana_cost", "") if faces else ""),
                "set": c.get("set"), "set_name": c.get("set_name"),
                "image_small": img.get("small"), "image": img.get("normal"),
            })
            if len(results) >= limit:
                return results
    return results


# ------------------------------------------------------------- cartes hors collection
TOP_CACHE = Path(__file__).parent / "data" / "top_cards_cache.json"
TOP_TTL = 7 * 24 * 3600  # une semaine


def top_cards(fmt, identity, pages=2):
    """Cartes les plus jouées (rang EDHREC) légales dans le format et dans les couleurs données.
    Résultat mis en cache une semaine par (format, couleurs)."""
    ident = "".join(c for c in "WUBRG" if c in identity) or "C"
    key = f"{fmt}:{ident}"
    cache = json.loads(TOP_CACHE.read_text(encoding="utf-8")) if TOP_CACHE.exists() else {}
    hit = cache.get(key)
    if hit and time.time() - hit["at"] < TOP_TTL:
        return hit["cards"]

    q = f"f:{fmt} id<={ident} -t:basic -is:funny game:paper"
    url, params, cards = SEARCH_URL, {"q": q, "order": "edhrec", "unique": "cards"}, []
    for _ in range(pages):
        r = requests.get(url, params=params, headers=HEADERS, timeout=30)
        time.sleep(0.12)
        if r.status_code == 404:
            break
        r.raise_for_status()
        j = r.json()
        cards += [_slim(c) for c in j["data"]]
        if not j.get("has_more"):
            break
        url, params = j["next_page"], None
    cache[key] = {"at": time.time(), "cards": cards}
    TOP_CACHE.parent.mkdir(exist_ok=True)
    TOP_CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    return cards


def french_for(cards):
    """Ajoute la version FR à une petite liste de cartes (dicts _slim), en place."""
    tmp = {c["name"].lower(): c for c in cards if "fr" not in c}
    if tmp:
        try:
            add_french(tmp, list(tmp))
        except requests.RequestException:
            pass
    return cards

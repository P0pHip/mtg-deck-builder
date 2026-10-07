"""Moteur déterministe de construction de deck (Commander et 60 cartes)."""
import re
from collections import Counter
from itertools import combinations

COLORS = "WUBRG"
BASICS = {"W": "Plains", "U": "Island", "B": "Swamp", "R": "Mountain", "G": "Forest"}
BASIC_NAMES = set(BASICS.values()) | {"Wastes"}

RX = {
    "wipe": re.compile(r"(destroy|exile) all (creatures|nonland|other creatures|permanents)|all creatures get -|deals? \d+ damage to each creature|return all nonland", re.I),
    "ramp": re.compile(r"add \{|add one mana|add (two|three) mana|search your library for (a|up to \w+) (basic )?lands?|put (a|up to \w+) lands? cards? .*onto the battlefield", re.I),
    "removal": re.compile(r"(destroy|exile) target|deals? (\d+|x) damage to (any target|target creature|target player or planeswalker)|counter target|return target (creature|nonland permanent).* to its owner's hand|target creature gets -\d+/-\d+|fights? (target|another target)|target player sacrifices", re.I),
    "draw": re.compile(r"draws? (a|an|two|three|four|x|that many|\w+) cards?|draw cards equal|look at the top .* put .* into your hand", re.I),
}

THEMES = {
    "tokens": r"token", "sacrifice": r"sacrifice", "mort": r"\bdies\b|dies,",
    "+1/+1": r"\+1/\+1 counter", "counters": r"counter on|proliferate", "cimetière": r"graveyard",
    "artefacts": r"artifact", "enchantements": r"enchantment", "terrains": r"landfall|land enters",
    "attaque": r"attacks|combat damage", "vol": r"flying", "vie": r"gain .* life|lifelink",
    "trésors": r"treasure", "sorts": r"instant or sorcery|noncreature spell",
}

# mots-clés de souhaits (FR / EN) -> (libellé, regex sur texte+type de la carte)
WISH_THEMES = [
    (r"token|jeton", "tokens", r"token"),
    (r"sacrifi", "sacrifice", r"sacrifice"),
    (r"\+1/\+1|marqueur|counter on|compteur", "+1/+1", r"\+1/\+1 counter|proliferate"),
    (r"cimeti|graveyard|reanim|réanim", "cimetière", r"graveyard"),
    (r"\bvol\b|volant|flying|flyer|oiseau", "vol", r"flying"),
    (r"artefact|artifact", "artefacts", r"artifact"),
    (r"enchant", "enchantements", r"enchantment"),
    (r"\bvie\b|life|lifelink|lien de vie", "gain de vie", r"gain .* life|lifelink"),
    (r"pioche|draw|carte en main", "pioche", r"draw"),
    (r"removal|destruc|tuer|kill|exil", "removal", r"destroy target|exile target|damage to (any|target)"),
    (r"contr[oô]le|control|contre|counterspell", "contrôle", r"counter target|draw"),
    (r"ramp|mana|accél", "ramp", r"add \{|search your library for .*land"),
    (r"terrain|landfall|land", "terrains", r"landfall|land enters"),
    (r"burn|brûl|dégât|damage", "burn", r"damage to (any target|each opponent|target player)"),
    (r"mill|meule", "meule", r"mill|into .* graveyard from .* library"),
]
TRIBES = {"elf": "Elf", "elfe": "Elf", "gobelin": "Goblin", "goblin": "Goblin", "dragon": "Dragon",
          "vampire": "Vampire", "ange": "Angel", "angel": "Angel", "zombie": "Zombie", "humain": "Human",
          "human": "Human", "chevalier": "Knight", "knight": "Knight", "soldat": "Soldier", "soldier": "Soldier",
          "ondin": "Merfolk", "merfolk": "Merfolk", "sorcier": "Wizard", "wizard": "Wizard", "chat": "Cat",
          "cat": "Cat", "dinosaure": "Dinosaur", "dinosaur": "Dinosaur", "pirate": "Pirate", "faerie": "Faerie",
          "fée": "Faerie", "slivoïde": "Sliver", "sliver": "Sliver", "démon": "Demon", "demon": "Demon"}
AGGRO = r"agress|aggro|rapide|fast|tempo|rush|bas de courbe|low curve|beatdown"


def wish_profile(text):
    """Transforme le texte libre en profil : thèmes, tribus, aggro."""
    t = (text or "").lower()
    if not t.strip():
        return None
    themes = [(label, rx) for kw, label, rx in WISH_THEMES if re.search(kw, t)]
    tribes = sorted({v for k, v in TRIBES.items() if re.search(rf"\b{k}s?\b", t)})
    return {"text": text.strip(), "themes": themes, "tribes": tribes, "aggro": bool(re.search(AGGRO, t))}


def wish_bonus(card, prof):
    if not prof:
        return 0.0
    txt = card["oracle_text"] + " " + card["type_line"]
    b = sum(0.35 for _, rx in prof["themes"] if re.search(rx, txt, re.I))
    if prof["tribes"] and (set(prof["tribes"]) & subtypes(card) or any(tr.lower() in txt.lower() for tr in prof["tribes"])):
        b += 0.5
    if prof["aggro"]:
        b += 0.25 if card["cmc"] <= 2 and "Creature" in card["type_line"] else 0
        b -= max(0, card["cmc"] - 3) * 0.1
    return min(b, 1.0)


def wish_summary(prof, chosen_cards):
    if not prof:
        return None
    nonland = [c for c in chosen_cards if c["category"] != "land"]
    fit = sum(1 for c in nonland if c.get("wish")) / max(len(nonland), 1)
    return {"text": prof["text"], "matched": [l for l, _ in prof["themes"]] + prof["tribes"] + (["aggro"] if prof["aggro"] else []),
            "fit": round(fit, 2)}


BUY_PENALTY = 0.35  # une carte à acheter doit être nettement meilleure qu'une carte possédée


def owned_qty(card):
    return card.get("owned_qty", card["quantity"])


def buy_penalty(card, n):
    """Pénalité proportionnelle à la part d'exemplaires qu'il faudrait acheter."""
    missing = max(0, n - owned_qty(card))
    return BUY_PENALTY * missing / max(n, 1)


def merge_external(owned, external, cap):
    """Fusionne la collection (libre) et des cartes hors collection.
    Chaque carte reçoit quantity = exemplaires utilisables (virtuels) et owned_qty = vraiment possédés."""
    pool = {c["name"]: {**c, "owned_qty": c["quantity"], "quantity": max(c["quantity"], cap)} for c in owned}
    for c in external:
        if c["name"] not in pool and c["name"] not in BASIC_NAMES:
            pool[c["name"]] = {**c, "owned_qty": 0, "quantity": cap, "external": True}
    return list(pool.values())


COMMANDER_TARGETS = {"land": 36, "ramp": 10, "draw": 10, "removal": 8, "wipe": 2}
SIXTY_LANDS = 24


# ---------------------------------------------------------------- utilitaires
def tags(card):
    t = card["type_line"]
    if "Land" in t.split("//")[0]:
        return ["land"]
    txt = card["oracle_text"]
    out = [k for k, rx in RX.items() if rx.search(txt)]
    if "Creature" in t:
        out.append("creature")
    return out or ["other"]


def category(card):
    tg = tags(card)
    for k in ("land", "wipe", "ramp", "removal", "draw", "creature"):
        if k in tg:
            return k
    return "other"


def quality(card):
    """Proxy de puissance : rang EDHREC fourni par Scryfall (plus bas = plus joué)."""
    r = card.get("edhrec_rank")
    if not r:
        return 0.15
    return max(0.0, 1 - min(r, 25000) / 25000)


def subtypes(card):
    t = card["type_line"].split("//")[0]
    return set(t.split("—")[1].split()) if "—" in t else set()


def commander_themes(cmd):
    txt = cmd["oracle_text"]
    return [k for k, rx in THEMES.items() if re.search(rx, txt, re.I)]


def synergy(card, cmd, themes, tribes):
    s = 0.0
    txt = card["oracle_text"]
    for th in themes:
        if re.search(THEMES[th], txt, re.I):
            s += 0.2
    if tribes & subtypes(card):
        s += 0.35
    for tribe in tribes:
        if tribe.lower() in txt.lower():
            s += 0.2
    return min(s, 0.9)


def in_identity(card, identity):
    return set(card["color_identity"]) <= set(identity)


def pips(cards):
    c = Counter()
    for card in cards:
        for col in COLORS:
            c[col] += card["mana_cost"].count("{" + col + "}") * card.get("count", 1)
    return c


def basics_split(n, pip_count, identity):
    identity = [c for c in COLORS if c in identity]
    if not identity:
        return {"Wastes": n} if n else {}
    total = sum(pip_count[c] for c in identity) or len(identity)
    split = {c: (pip_count[c] or (total / len(identity))) / total * n for c in identity}
    res = {c: int(v) for c, v in split.items()}
    for c in sorted(split, key=lambda c: split[c] - res[c], reverse=True)[: n - sum(res.values())]:
        res[c] += 1
    return {BASICS[c]: v for c, v in res.items() if v}


def land_is_useful(card, identity):
    if card["name"] in BASIC_NAMES:
        return False
    if card["color_identity"]:
        return set(card["color_identity"]) <= set(identity) and bool(set(card["color_identity"]) & set(identity))
    txt = card["oracle_text"].lower()
    return any(k in txt for k in ("any color", "commander", "search your library", "add {c}"))


TYPE_ORDER = ["Creature", "Planeswalker", "Battle", "Instant", "Sorcery", "Artifact", "Enchantment", "Land"]


def main_type(type_line):
    """Type principal (face avant) : une créature-artefact compte comme créature, etc."""
    front = type_line.split("//")[0]
    return next((t for t in TYPE_ORDER if t in front), "Other")


def summarize(deck, fmt, extra):
    cards = [c for c in deck]
    for c in cards:
        if c.get("owned_max") is not None:
            c["owned"] = min(c["count"], c["owned_max"])
            c["missing"] = c["count"] - c["owned"]
    to_buy = [{"name": c["name"], "count": c["missing"], "owned": c["owned"], "price_eur": c.get("price_eur"),
               "scryfall_uri": c.get("scryfall_uri")} for c in cards if c.get("missing")]
    extra = {**extra, "to_buy": sorted(to_buy, key=lambda b: -(b["price_eur"] or 0)),
             "buy_cost": round(sum((b["price_eur"] or 0) * b["count"] for b in to_buy), 2)}
    curve = Counter()
    for c in cards:
        if c["category"] != "land":
            curve[min(int(c["cmc"]), 7)] += c["count"]
    nonland = [c for c in cards if c["category"] != "land"]
    n_nonland = sum(c["count"] for c in nonland) or 1
    return {
        "format": fmt,
        "cards": sorted(cards, key=lambda c: (c["category"], c["cmc"], c["name"])),
        "total": sum(c["count"] for c in cards),
        "curve": {str(k): curve.get(k, 0) for k in range(8)},
        "avg_cmc": round(sum(c["cmc"] * c["count"] for c in nonland) / n_nonland, 2),
        "categories": dict(sum((Counter({c["category"]: c["count"]}) for c in cards), Counter())),
        "types": {t: n for t in TYPE_ORDER + ["Other"]
                  if (n := sum(c["count"] for c in cards if main_type(c["type_line"]) == t))},
        "value_eur": round(sum((c.get("price_eur") or 0) * c["count"] for c in cards), 2),
        **extra,
    }


def _entry(card, count, score=0.0, cat=None):
    return {
        "name": card["name"], "count": count, "cmc": card["cmc"], "mana_cost": card["mana_cost"],
        "type_line": card["type_line"], "category": cat or category(card), "score": round(score, 3),
        "price_eur": card.get("price_eur"), "image": card.get("image"), "image_small": card.get("image_small"),
        "image_back": card.get("image_back"), "scryfall_uri": card.get("scryfall_uri"), "oracle_text": card["oracle_text"],
        "fr": card.get("fr"),
        "owned_max": owned_qty(card) if "owned_qty" in card else None,
    }


# ------------------------------------------------------------------ Commander
def commanders(collection):
    out = []
    for c in collection:
        t = c["type_line"].split("//")[0]
        ok = ("Legendary" in t and "Creature" in t) or "can be your commander" in c["oracle_text"]
        if ok and c["legalities"].get("commander") == "legal":
            out.append(c)
    return sorted(out, key=lambda c: c["name"])


def build_commander(collection, commander_name, wish=None):
    cmd = next(c for c in collection if c["name"] == commander_name)
    identity = cmd["color_identity"]
    themes = commander_themes(cmd)
    tribes = subtypes(cmd) - {"Human", "Legendary"}

    pool = [c for c in collection
            if c["name"] != cmd["name"]
            and c["legalities"].get("commander") == "legal"
            and in_identity(c, identity)]

    spells = []
    for c in pool:
        if category(c) == "land":
            continue
        s = quality(c) + synergy(c, cmd, themes, tribes)
        wb = wish_bonus(c, wish)
        if c["cmc"] >= 7:
            s -= 0.25
        spells.append((s + wb - buy_penalty(c, 1), s, c, wb))
    spells.sort(key=lambda x: x[0], reverse=True)

    def ent(c, s, wb, role=None):
        e = _entry(c, 1, s, role)
        e["wish"] = wb > 0.2
        return e

    chosen, used = [], set()
    n_spells = 99 - COMMANDER_TARGETS["land"]
    # 1) quotas par rôle
    for role in ("ramp", "draw", "removal", "wipe"):
        quota = COMMANDER_TARGETS[role]
        for _, s, c, wb in spells:
            if quota <= 0:
                break
            if c["name"] not in used and role in tags(c):
                chosen.append(ent(c, s, wb, role)); used.add(c["name"]); quota -= 1
    # 2) meilleurs cartes restantes (le souhait du joueur pèse dans l'ordre)
    for _, s, c, wb in spells:
        if len(chosen) >= n_spells:
            break
        if c["name"] not in used:
            chosen.append(ent(c, s, wb)); used.add(c["name"])

    # 3) terrains
    n_lands = COMMANDER_TARGETS["land"] + max(0, min(2, n_spells - len(chosen)))
    lands = sorted([c for c in pool if category(c) == "land" and land_is_useful(c, identity)],
                   key=lambda l: quality(l) - buy_penalty(l, 1), reverse=True)
    if len(identity) <= 1:
        lands = [l for l in lands if "Command Tower" not in l["name"]]
    land_entries = [_entry(l, 1, quality(l), "land") for l in lands[: min(len(lands), n_lands - 10)]]
    basics = basics_split(n_lands - len(land_entries), pips(chosen), identity)
    for name, n in basics.items():
        land_entries.append({"name": name, "count": n, "cmc": 0, "mana_cost": "", "type_line": "Basic Land",
                             "category": "land", "score": 0, "price_eur": None, "image": None,
                             "image_small": None, "scryfall_uri": None, "oracle_text": ""})

    deck = chosen + land_entries
    warnings = []
    for role in ("ramp", "draw", "removal"):
        have = sum(1 for c in chosen if c["category"] == role)
        if have < COMMANDER_TARGETS[role] - 2:
            warnings.append(f"Peu de cartes '{role}' dans ta collection pour ces couleurs ({have}/{COMMANDER_TARGETS[role]}).")
    missing = 99 - len(chosen) - n_lands
    if missing > 0:
        warnings.insert(0, f"Deck incomplet : il manque {missing} sorts dans ta collection pour cette identité de couleurs.")
    filler = sum(1 for c in chosen if c["score"] < 0.2)
    if filler > 15:
        warnings.append(f"{filler} cartes de remplissage faibles : ta collection est un peu courte dans cette identité.")

    score = sum(c["score"] for c in chosen) / max(len(chosen), 1)
    return summarize(deck, "commander", {
        "commander": _entry(cmd, 1, quality(cmd), "commander"),
        "identity": identity, "themes": themes, "tribes": sorted(tribes),
        "score": round(score, 3), "warnings": warnings, "wish": wish_summary(wish, chosen),
    })


def best_commander(collection, wish=None):
    """Meilleur commandant : puissance + adéquation au souhait (et le commandant lui-même)."""
    def value(d, cmd):
        v = d["score"]
        if wish:
            v += d["wish"]["fit"] * 0.6 + wish_bonus(cmd, wish) * 0.5
        return v
    best, best_v = None, -1
    for c in commanders(collection):
        d = build_commander(collection, c["name"], wish)
        v = value(d, c)
        if v > best_v:
            best, best_v = d, v
    return best


# ------------------------------------------------------------------ 60 cartes
def _sixty_pool(collection, fmt, colors):
    return [c for c in collection
            if c["legalities"].get(fmt) == "legal" and in_identity(c, colors)
            and c["name"] not in BASIC_NAMES]


def build_sixty(collection, fmt, colors=None, wish=None):
    if not colors:
        colors = best_colors(collection, fmt, wish)
    pool = _sixty_pool(collection, fmt, colors)

    spells = []
    for c in pool:
        if category(c) == "land":
            continue
        s = quality(c) + (0.1 if "removal" in tags(c) else 0)
        s -= max(0, c["cmc"] - 3) * 0.12  # on favorise une courbe basse
        if set(c["color_identity"]) == set(colors) and len(colors) > 1:
            s += 0.05
        wb = wish_bonus(c, wish)
        spells.append((s + wb - buy_penalty(c, min(c["quantity"], 4)), s, c, wb))
    spells.sort(key=lambda x: x[0], reverse=True)

    target = 60 - SIXTY_LANDS
    chosen, total = [], 0
    cmc_caps = {4: 8, 5: 4, 6: 2}
    used_by_cmc = Counter()
    for _, s, c, wb in spells:
        if total >= target:
            break
        cap_key = min(int(c["cmc"]), 6)
        room = cmc_caps.get(cap_key, 99) - used_by_cmc[cap_key] if cap_key >= 4 else 99
        n = min(c["quantity"], 4, target - total, room)
        if n <= 0:
            continue
        e = _entry(c, n, s); e["wish"] = wb > 0.2
        chosen.append(e); total += n; used_by_cmc[cap_key] += n

    lands = [c for c in pool if category(c) == "land" and land_is_useful(c, colors)]
    land_entries, n_land = [], 0
    for l in sorted(lands, key=lambda l: quality(l) - buy_penalty(l, min(l["quantity"], 4)), reverse=True):
        n = min(l["quantity"], 4, 12 - n_land)
        if n <= 0:
            break
        land_entries.append(_entry(l, n, quality(l), "land")); n_land += n
    for name, n in basics_split(SIXTY_LANDS - n_land, pips(chosen), colors).items():
        land_entries.append({"name": name, "count": n, "cmc": 0, "mana_cost": "", "type_line": "Basic Land",
                             "category": "land", "score": 0, "price_eur": None, "image": None,
                             "image_small": None, "scryfall_uri": None, "oracle_text": ""})

    warnings = []
    if total < target:
        warnings.append(f"Seulement {total} sorts légaux en {fmt} dans ces couleurs (il en faudrait {target}).")
    score = sum(c["score"] * c["count"] for c in chosen) / max(total, 1)
    return summarize(chosen + land_entries, fmt, {
        "identity": [c for c in COLORS if c in colors], "score": round(score, 3), "warnings": warnings,
        "wish": wish_summary(wish, chosen),
    })


def best_colors(collection, fmt, wish=None):
    best, best_val = ["R"], -1
    for k in (1, 2):
        for combo in combinations(COLORS, k):
            pool = [c for c in _sixty_pool(collection, fmt, combo) if category(c) != "land"]
            vals = sorted((quality(c) + wish_bonus(c, wish) for c in pool for _ in range(min(c["quantity"], 4))), reverse=True)
            val = sum(vals[:36]) - (0 if len(vals) >= 36 else (36 - len(vals)) * 0.3)
            if val > best_val:
                best, best_val = list(combo), val
    return best


# ------------------------------------------------------- modifications (chat)
def legal_pool(collection, deck):
    """Cartes possédées utilisables dans ce deck (format + couleurs)."""
    fmt, identity = deck["format"], deck["identity"]
    return [c for c in collection
            if c["legalities"].get(fmt) == "legal" and in_identity(c, identity)
            and c["name"] not in BASIC_NAMES]


def apply_changes(deck, collection, remove, add):
    """Applique des échanges demandés par le chat, en vérifiant que tout est possédé et légal.
    remove / add : listes de {"name": str, "count": int}. Retourne (nouveau_deck, journal)."""
    by_name = {c["name"].lower(): c for c in legal_pool(collection, deck)}
    for c in collection:  # accepte aussi les noms FR
        if c.get("fr") and c["name"].lower() in by_name:
            by_name.setdefault(c["fr"]["name"].lower(), c)
    singleton = deck["format"] == "commander"
    cards = {c["name"]: dict(c) for c in deck["cards"]}
    log = []

    for r in remove or []:
        wanted = str(r.get("name", "")).strip().lower()
        wanted = {"plaine": "plains", "île": "island", "marais": "swamp", "montagne": "mountain",
                  "forêt": "forest"}.get(wanted, wanted)
        name = next((n for n in cards if n.lower() == wanted
                     or (cards[n].get("fr") or {}).get("name", "").lower() == wanted), None)
        if not name:
            log.append(f"✗ {r.get('name')} n'est pas dans le deck"); continue
        n = 1 if singleton else max(1, int(r.get("count", cards[name]["count"])))
        cards[name]["count"] -= n
        if cards[name]["count"] <= 0:
            del cards[name]
        log.append(f"− {n} {name}")

    basic_fr = {"plaine": "Plains", "île": "Island", "marais": "Swamp", "montagne": "Mountain", "forêt": "Forest"}
    for a in add or []:
        wanted = str(a.get("name", "")).strip()
        basic = next((b for b in BASIC_NAMES if b.lower() == wanted.lower()), None) or basic_fr.get(wanted.lower())
        if basic:  # terrains de base : illimités, tant qu'ils sont dans les couleurs du deck
            col = next((k for k, v in BASICS.items() if v == basic), None)
            if col and col not in deck["identity"]:
                log.append(f"✗ {basic} : couleur hors du deck"); continue
            n = max(1, int(a.get("count", 1)))
            if basic in cards:
                cards[basic]["count"] += n
            else:
                cards[basic] = {"name": basic, "count": n, "cmc": 0, "mana_cost": "", "type_line": "Basic Land",
                                "category": "land", "score": 0, "price_eur": None, "image": None,
                                "image_small": None, "image_back": None, "scryfall_uri": None, "oracle_text": "", "fr": None}
            log.append(f"+ {n} {basic}"); continue
        c = by_name.get(wanted.lower())
        if not c:
            log.append(f"✗ {a.get('name')} : pas dans ta collection ou illégal dans ce deck"); continue
        have = cards.get(c["name"], {}).get("count", 0)
        cap = 1 if singleton else min(c["quantity"], 4)
        n = min(1 if singleton else max(1, int(a.get("count", 1))), cap - have)
        if n <= 0:
            log.append(f"✗ {c['name']} : déjà au maximum"); continue
        if c["name"] in cards:
            cards[c["name"]]["count"] += n
        else:
            cards[c["name"]] = _entry(c, n, quality(c))
        log.append(f"+ {n} {c['name']}")

    extra = {k: v for k, v in deck.items()
             if k not in ("cards", "total", "curve", "avg_cmc", "categories", "value_eur", "format")}
    return summarize(list(cards.values()), deck["format"], extra), log

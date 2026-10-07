"""Appel à Ollama pour commenter le deck généré."""
import os
import re

import requests

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen3:14b")

BASICS_FR = {"Plains": "Plaine", "Island": "Île", "Swamp": "Marais", "Mountain": "Montagne", "Forest": "Forêt", "Wastes": "Désert"}


def dn(card, lang):
    """Nom affiché d'une carte dans la langue choisie."""
    if lang == "fr":
        return (card.get("fr") or {}).get("name") or BASICS_FR.get(card["name"]) or card["name"]
    return card["name"]


def dtext(card, lang):
    if lang == "fr":
        return (card.get("fr") or {}).get("text") or card.get("oracle_text", "")
    return card.get("oracle_text", "")


def localize(text, cards, lang):
    """Filet de sécurité : remplace dans la réponse les noms de cartes de l'autre langue."""
    pairs = []
    for c in cards:
        fr = (c.get("fr") or {}).get("name") or BASICS_FR.get(c["name"])
        if not fr or fr == c["name"]:
            continue
        pairs.append((c["name"], fr) if lang == "fr" else (fr, c["name"]))
    for src, dst in sorted(set(pairs), key=lambda p: -len(p[0])):
        if len(src) > 3:
            text = re.sub(rf"(?<![\w']){re.escape(src)}(?![\w'])", dst, text)
    return text


def explain(deck, collection, lang="fr"):
    in_deck = {c["name"] for c in deck["cards"]}
    lines = [f'{c["count"]}x {dn(c, lang)} [{c["category"]}] {c["mana_cost"]}' for c in deck["cards"]]
    bench = sorted((c for c in collection if c["name"] not in in_deck
                    and set(c["color_identity"]) <= set(deck["identity"])
                    and "Land" not in c["type_line"]),
                   key=lambda c: c.get("edhrec_rank") or 99999)[:25]

    header = f'Format : {deck["format"]}. Couleurs : {"".join(deck["identity"]) or "incolore"}.'
    if deck.get("commander"):
        header += f' Commandant : {dn(deck["commander"], lang)} — {dtext(deck["commander"], lang)}'

    prompt = f"""{header}
Courbe de mana : {deck["curve"]} (CMC moyen {deck["avg_cmc"]}).

Decklist générée automatiquement à partir de MA collection :
{chr(10).join(lines)}

Cartes de ma collection NON utilisées mais dans les couleurs :
{", ".join(dn(c, lang) for c in bench)}

Réponds en français, de façon concise, en markdown :
1. **Plan de jeu** : comment ce deck gagne (3-4 phrases).
2. **Points forts / faiblesses**.
3. **3 échanges conseillés** : uniquement entre une carte du deck et une carte de la liste "non utilisées" ci-dessus. N'invente aucune carte que je ne possède pas.
4. **Conseil de mulligan** en une phrase."""

    if lang == "en":
        prompt += ("\n\nIMPORTANT: answer in English (same structure: game plan, strengths/weaknesses, 3 swaps, mulligan tip). "
                   "Always use the English card names exactly as written in the lists above.")
    else:
        prompt += ("\nIMPORTANT : cite TOUJOURS les cartes avec leur nom français, exactement comme écrit "
                   "dans les listes ci-dessus. N'utilise pas les noms anglais.")
    try:
        r = requests.post(f"{OLLAMA_URL}/api/chat", json={
            "model": OLLAMA_MODEL,
            "messages": [
                {"role": "system", "content": "Tu es un joueur expert de Magic: The Gathering et un deckbuilder rigoureux."},
                {"role": "user", "content": prompt},
            ],
            "stream": False,
            "think": False,
            "options": {"num_ctx": 8192, "temperature": 0.4},
        }, timeout=600)
        r.raise_for_status()
        text = re.sub(r"<think>.*?</think>", "", r.json()["message"]["content"], flags=re.S).strip()
        return localize(text, list(deck["cards"]) + list(collection) + ([deck["commander"]] if deck.get("commander") else []), lang)
    except requests.exceptions.ConnectionError:
        return f"⚠️ Ollama injoignable sur {OLLAMA_URL}. Lance l'appli Ollama (ou `ollama serve`)."
    except Exception as e:  # noqa: BLE001
        return f"⚠️ Erreur Ollama : {e}. Vérifie que le modèle est installé : `ollama pull {OLLAMA_MODEL}`"


# --------------------------------------------------------------------- chat
CHAT_RULES = {
    "fr": """Tu aides le joueur à améliorer SON deck, construit uniquement avec SA collection.
Si le joueur demande une modification (échange, plus agressif, moins de cartes chères…), propose-la
puis termine ta réponse par un bloc JSON EXACTEMENT de cette forme :
```json
{"remove": [{"name": "Nom de la carte", "count": 1}], "add": [{"name": "Nom de la carte", "count": 1}]}
```
Règles : n'ajoute QUE des cartes de la liste « disponibles ». Garde le même nombre total de cartes
(autant de retraits que d'ajouts). En Commander, count vaut toujours 1. Pas de bloc JSON si aucune modification.
Cite TOUJOURS les cartes avec leur nom français, exactement comme écrit dans les listes (y compris dans le JSON).
Réponds en français, de façon concise.""",
    "en": """You help the player improve THEIR deck, built only from THEIR collection.
If the player asks for a change, propose it and end your answer with a JSON block EXACTLY like:
```json
{"remove": [{"name": "English name", "count": 1}], "add": [{"name": "English name", "count": 1}]}
```
Rules: only add cards from the "available" list. Keep the same total card count. In Commander, count is always 1.
No JSON block if there is no change. Always use the English card names exactly as written in the lists.
Answer in English, concisely.""",
}


def chat(deck, available, history, lang="fr", everything=None):
    """history : [{"role": "user"|"assistant", "content": str}]. Retourne (texte, changements|None)."""
    import json as _json
    in_deck = {c["name"] for c in deck["cards"]}
    decklist = "\n".join(f'{c["count"]}x {dn(c, lang)} — {c["type_line"]} — rôle: {c["category"]} — cmc {c["cmc"]}'
                         + (f' — À ACHETER x{c["missing"]}' if c.get("missing") else "")
                         for c in deck["cards"])
    avail = sorted((c for c in available if c["name"] not in in_deck), key=lambda c: c.get("edhrec_rank") or 99999)[:150]
    avail_txt = "\n".join(f'{dn(c, lang)} (x{c["quantity"]}) — {c["type_line"]} — {c["mana_cost"]} — {dtext(c, lang)[:120]}'
                          for c in avail)
    context = f"""Format : {deck["format"]} | Couleurs : {"".join(deck["identity"]) or "C"}
{"Commandant : " + dn(deck["commander"], lang) + " — " + dtext(deck["commander"], lang) if deck.get("commander") else ""}
Courbe : {deck["curve"]} | CMC moyen : {deck["avg_cmc"]} | Total : {deck["total"]}
RÉPARTITION PAR TYPE (exacte, calculée par le programme — utilise ces chiffres) : {deck.get("types")}
Note : le « rôle » (ramp, draw…) est une fonction ; le type (Creature, Instant…) est la nature de la carte.

DECK ACTUEL :
{decklist}

CARTES DISPONIBLES (possédées, légales, hors deck) :
{avail_txt}"""
    messages = [{"role": "system", "content": CHAT_RULES.get(lang, CHAT_RULES["fr"]) + "\n\n" + context}] + history[-12:]
    try:
        r = requests.post(f"{OLLAMA_URL}/api/chat", json={
            "model": OLLAMA_MODEL, "messages": messages, "stream": False, "think": False,
            "options": {"num_ctx": 16384, "temperature": 0.4},
        }, timeout=600)
        r.raise_for_status()
        text = re.sub(r"<think>.*?</think>", "", r.json()["message"]["content"], flags=re.S).strip()
    except requests.exceptions.ConnectionError:
        return f"⚠️ Ollama injoignable sur {OLLAMA_URL}.", None
    except Exception as e:  # noqa: BLE001
        return f"⚠️ Erreur Ollama : {e}", None

    changes = None
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, flags=re.S)
    if m:
        try:
            changes = _json.loads(m.group(1))
            text = (text[:m.start()] + text[m.end():]).strip()
        except ValueError:
            changes = None
    known = list(deck["cards"]) + list(available) + list(everything or []) + ([deck["commander"]] if deck.get("commander") else [])
    return localize(text, known, lang), changes

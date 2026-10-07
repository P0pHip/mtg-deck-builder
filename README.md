# MTG Deck Builder

Construit des decks optimisés **uniquement avec les cartes que tu possèdes**.

- **Scryfall** : enrichit ta collection (texte, coût, légalités, prix, rang EDHREC).
- **Moteur déterministe** (`builder.py`) : filtres de légalité et de couleurs, quotas ramp/pioche/removal, synergies avec le commandant, courbe de mana, base de terrains.
- **Ollama** (`qwen3:14b` par défaut) : explique le plan de jeu et propose des échanges, toujours parmi tes cartes.

## Lancer

1. Ollama doit tourner, avec le modèle installé : `ollama pull qwen3:14b`
2. Double-clique sur **`lancer.bat`**. Au premier lancement, il crée l'environnement Python et installe Flask et Requests. Le navigateur s'ouvre ensuite sur http://localhost:5000.

À la main : `pip install -r requirements.txt` puis `python app.py`.

## Utilisation

1. **Import** : glisse ton CSV ou JSON (colonnes `name`, `quantity`, `set`), ou charge l'exemple.
2. **Collection** : tableau triable et filtrable. Survole une ligne pour voir la carte.
3. **Construire** : choisis le format. En Commander, choisis un commandant ou laisse le mode auto. En 60 cartes, choisis les couleurs ou laisse le mode auto. Bouton « Copier » pour l'import dans Arena ou Moxfield.

## Configuration

Variables d'environnement : `OLLAMA_MODEL` (ex. `gpt-oss:20b`) et `OLLAMA_URL` (par défaut `http://localhost:11434`).

## Fichiers

| Fichier | Rôle |
|---|---|
| `app.py` | serveur Flask et routes API |
| `scryfall.py` | lecture CSV/JSON, appels `/cards/collection` par paquets de 75, cache local |
| `builder.py` | logique de construction (à faire évoluer !) |
| `ai.py` | prompt et appel à Ollama |
| `static/index.html` | interface |
| `data/` | collection importée et cache Scryfall |

## Pistes d'amélioration
- Synergies réelles via les pages JSON d'EDHREC (`json.edhrec.com/pages/commanders/<slug>.json`)
- Liste d'achats : les meilleures cartes manquantes pour un commandant (recherche Scryfall)
- Tool calling : laisser le LLM interroger la collection lui-même

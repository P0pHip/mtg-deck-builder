# MTG Deck Builder

Construis des decks **Magic: The Gathering** optimisés à partir de **ta** collection, directement dans ton navigateur ou sur ton téléphone,
avec une **IA locale** (Gemma 4) qui tourne sur l'appareil.

- 📚 **Collection** : import CSV/JSON (ManaBox, Moxfield, Delver Lens…), ajout par recherche, +/−, noms et images en français, **règles officielles** de chaque carte ;
  rangement en **dossiers** (extension, couleur, type, deck) avec la **complétion** de chaque extension, et vue **liste** ou **tuiles** ;
  **exemplaires** détaillés (édition, numéro, langue, foil, état) avec leur propre prix.
- 📷 **Scanner** : caméra du téléphone ou webcam, lecture du nom et de l'impression exacte, **image figée** pour lire sans flou, mode **rafale** (une carte après l'autre, sans toucher l'écran), reconnaissance par l'IA.
- ⭐ **Liste d'envies** : cartes à acheter (depuis la recherche, une fiche, la liste d'achats d'un deck…), total, copie pour Cardmarket ;
  **prix cible** par carte avec alerte 🔔 quand elle passe en dessous (prix relus une fois par jour).
- 🎁 **Decks préconstruits** : decks Commander, de démarrage… vendus par Wizards, ajoutés d'un coup (listes [MTGJSON](https://mtgjson.com)).
- ❤️ **Compteur de partie** : points de vie de 2 à 6 joueurs, poison, blessures de commandant, dés, « qui commence ? » ; écran toujours allumé ;
  **historique des parties** (gagnant, victoires par deck et par joueur).
- 🎓 **Tutoriel** intégré (bouton « ? » en haut).
- 🛠️ **Construction** : Commander ou 60 cartes (Modern, Pioneer, Standard, Legacy, Pauper), souhaits en texte libre, cartes hors collection avec liste d'achats,
  **synergies réelles du commandant** (EDHREC), **💡 idées de decks** (les meilleurs decks possibles avec ta collection, dans tous les formats) ;
  **main de départ** d'essai (mulligan, pioche) et probabilités de terrains ; **✨ améliorer un deck** (ex. préconstruit) avec ses meilleures cartes libres ;
  **♾️ combos** du deck et ceux à une carte près ([Commander Spellbook](https://commanderspellbook.com)) ; **📤 export** de la decklist (Moxfield / Archidekt, MTG Arena)
  et **🔗 lien de partage** (ou **QR code** à scanner à la table) : le deck s'ouvre dans l'appli d'un ami, qui voit ce qu'il a déjà et ce qui lui manque.
- 📊 **Statistiques** : valeur et son évolution, mise à jour des prix, répartitions, cartes les plus chères, doubles à échanger, export CSV.
- 🗂️ **Decks enregistrés** : leurs cartes sont réservées ; emprunt ou « éclatement » d'un deck quand il le faut.
- 📥 **Import de decklist** (Moxfield, Archidekt, Arena, MTGO…) : ce que tu as déjà, ce qui manque et son prix, puis enregistrement du deck.
- 🤖 **IA locale** : analyse du deck et chat qui modifie le deck (échanges vérifiés). Aucune donnée envoyée, fonctionne hors ligne.
- 📱 **PWA** : installable, utilisable hors ligne, données stockées sur l'appareil.

**Appli en ligne** : `https://<ton-pseudo>.github.io/mtg-deck-builder/`

## Développement

Prérequis : Node.js 20+.

```bash
npm install
npm run dev        # serveur local avec rechargement : http://localhost:5173
npm test           # tests (Vitest)
npm run build      # build de production dans dist/
npm run preview    # sert dist/ en local
```

## Structure

```
├── index.html              page de l'appli (point d'entrée Vite)
├── src/
│   ├── main.js             assemblage des vues, onglets, service worker
│   ├── core/               moteur de deck — pur, sans DOM ni réseau
│   ├── data/               IndexedDB, sauvegarde, client Scryfall
│   ├── services/           cas d'usage (générer, importer, éditer)
│   ├── ai/                 IA locale : modèle, moteur LiteRT-LM, prompts, assistant
│   ├── ui/                 vues, état, textes FR/EN
│   └── styles/             CSS
├── public/                 manifeste PWA, service worker, icônes, collection d'exemple
├── tests/                  tests Vitest (+ fixtures de référence)
├── docs/ARCHITECTURE.md    architecture détaillée, schémas, choix techniques
└── .github/workflows/      CI : tests, build, déploiement GitHub Pages
```

Détails : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Déploiement

À chaque push sur `main`, GitHub Actions lance les tests, construit l'appli et la publie sur GitHub Pages.
Réglage à faire une fois : **Settings → Pages → Source : GitHub Actions**.

## IA locale (Gemma 4 E2B)

Onglet **Plus → IA locale** : télécharge le modèle (≈2 Go, une seule fois, de préférence en Wi-Fi), puis utilise
« Analyser le deck » et le chat dans l'onglet Construire.

Il faut un navigateur avec **WebGPU** : Chrome à jour sur Android, Safari sur iOS 26+, ou Chrome / Edge sur PC.
Prévoir ~6 Go de RAM pour un usage confortable. Le moteur est [LiteRT-LM](https://ai.google.dev/edge/litert-lm) (Google), encore en préversion.

## Données

Tout est stocké dans le navigateur (IndexedDB). **Plus → Exporter une sauvegarde** régulièrement :
effacer les données du site efface aussi la collection.

Données des cartes : [Scryfall](https://scryfall.com). Ce projet n'est pas affilié à Wizards of the Coast.

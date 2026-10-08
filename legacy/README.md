# Anciennes versions (conservées pour référence)

| Dossier | Contenu |
|---|---|
| `pc-flask/` | Version PC d'origine : serveur Python/Flask, base SQLite, analyse et chat via **Ollama** (qwen3). Lancement : `pc-flask/lancer.bat`. |
| `mobile-v1/` | Première version mobile (PWA sans outil de build), remplacée par l'appli à la racine du dépôt. |

Le moteur de deck actuel (`src/core/`) est un portage exact de `pc-flask/builder.py` ;
`tests/core/builder.test.js` le vérifie avec des résultats de référence générés par la version Python.

Pour transférer une collection de l'ancienne appli PC vers la nouvelle : lance `pc-flask/lancer.bat`,
onglet Import → « 📱 Exporter pour l'appli mobile », puis dans la web app : Plus → Restaurer une sauvegarde.

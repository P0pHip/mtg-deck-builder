# MTG Deck Builder — version mobile (PWA)

Appli **100 % autonome** dans le navigateur du téléphone : pas besoin du PC allumé.
- Données des cartes : API Scryfall, appelée directement depuis le téléphone (Internet nécessaire pour importer, chercher et ajouter des cartes).
- Collection et decks : stockés **sur le téléphone** (IndexedDB).
- Hors ligne : l'appli s'ouvre et tu peux consulter ta collection et construire des decks avec les cartes déjà chargées.
- Pas d'IA (l'analyse et le chat restent sur l'appli PC).

## Mettre l'appli en ligne (gratuit, une seule fois)

Une PWA doit être servie en **HTTPS** pour pouvoir s'installer. Deux options simples :

### Option A : Netlify Drop (le plus rapide, sans git)
1. Va sur https://app.netlify.com/drop (crée un compte gratuit pour garder le site).
2. Glisse le dossier **`mobile`** dans la page.
3. Netlify te donne une adresse du type `https://xxx.netlify.app` : ouvre-la sur ton téléphone.
Pour mettre à jour : re-glisse le dossier dans « Deploys » du site.

### Option B : GitHub Pages
1. Pousse le dépôt sur GitHub (`git remote add origin …` puis `git push -u origin main`).
2. Sur GitHub : Settings → Pages → Source « Deploy from a branch » → branche `main`, dossier `/ (root)`.
3. L'appli sera à `https://<ton-pseudo>.github.io/<depot>/mobile/`.

## L'installer sur le téléphone
- **Android (Chrome)** : menu ⋮ → « Installer l'application » (ou « Ajouter à l'écran d'accueil »).
- **iPhone (Safari)** : bouton Partager → « Sur l'écran d'accueil ».

## Récupérer ta collection du PC
1. Sur le PC, lance l'appli (`lancer.bat`) puis onglet Import → **📱 Exporter pour l'appli mobile**
   (ou ouvre directement http://localhost:5000/api/export). Un fichier `mtg-sauvegarde-AAAA-MM-JJ.json` est téléchargé.
2. Envoie-le sur ton téléphone (mail, Drive, câble…).
3. Dans l'appli mobile : onglet **Plus → 📥 Restaurer une sauvegarde**.

Pense à faire **Plus → 💾 Exporter une sauvegarde** de temps en temps : si tu vides les données du navigateur, tout est perdu.

## Tester sur le PC
Depuis le dossier `mobile` : `py -m http.server 8080` puis http://localhost:8080
(sur `localhost` le service worker fonctionne aussi).

## Fichiers
| Fichier | Rôle |
|---|---|
| `index.html`, `style.css` | interface mobile (onglets en bas) |
| `js/builder.js` | moteur de deck, portage exact de `builder.py` (testé : decks identiques) |
| `js/scryfall.js` | import CSV/JSON, appels Scryfall, noms FR, cartes hors collection |
| `js/store.js` | stockage local, decks, réservations, sauvegarde |
| `js/app.js`, `js/i18n.js` | logique de l'interface, textes FR/EN |
| `sw.js`, `manifest.webmanifest`, `icons/` | installation et mode hors ligne |

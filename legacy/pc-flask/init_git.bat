@echo off
cd /d "%~dp0"
where git >nul 2>&1 || (echo [ERREUR] Git introuvable. Installe-le avec : winget install Git.Git & pause & exit /b)
if exist .git (echo Le depot git existe deja. & git log --oneline -5 & pause & exit /b)
git init -b main
git add -A
git commit -m "MTG Deck Builder : import Scryfall, moteur de deck, chat Ollama, decks enregistres (SQLite)" -m "- Import CSV/JSON + ajout manuel, enrichissement Scryfall (EN/FR, bifaces)" -m "- Construction Commander / 60 cartes, souhaits, cartes hors collection" -m "- Decks enregistres avec reservation des cartes, eclatement" -m "- Analyse et chat via Ollama" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01GW1CSxHNNXN3CMZmK97WsT"
if errorlevel 1 (
  echo.
  echo Si git demande ton identite, lance une fois :
  echo   git config --global user.name "Mathieu"
  echo   git config --global user.email "ton@email"
  echo puis relance ce script.
  rmdir /s /q .git
)
echo.
git log --oneline -5
pause

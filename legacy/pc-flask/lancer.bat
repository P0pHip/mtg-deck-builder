@echo off
setlocal
cd /d "%~dp0"
title MTG Deck Builder

rem --- Trouver Python (lanceur "py" d'abord, puis "python")
set "PY="
where py >nul 2>&1 && set "PY=py -3"
if not defined PY (
  python --version >nul 2>&1 && set "PY=python"
)
if not defined PY (
  echo [ERREUR] Python introuvable dans le PATH.
  echo Redemarre le PC apres l'installation, ou desactive les alias "python.exe"
  echo dans Parametres ^> Applications ^> Parametres avances ^> Alias d'execution.
  goto :fin
)
echo Python trouve :
%PY% --version

rem --- Environnement virtuel (recree s'il est casse)
if exist ".venv\Scripts\python.exe" goto :deps
echo Creation de l'environnement virtuel...
if exist .venv rmdir /s /q .venv
%PY% -m venv .venv
if errorlevel 1 (
  echo [ERREUR] Impossible de creer l'environnement virtuel.
  goto :fin
)

:deps
echo Installation / verification des dependances...
".venv\Scripts\python.exe" -m pip install -q --disable-pip-version-check -r requirements.txt
if errorlevel 1 (
  echo [ERREUR] Installation des dependances echouee.
  goto :fin
)

echo.
echo Demarrage du serveur sur http://localhost:5000  (Ctrl+C pour arreter)
start "" http://localhost:5000
".venv\Scripts\python.exe" app.py

:fin
echo.
pause

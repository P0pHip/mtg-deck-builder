@echo off
rem Ajoute Python (trouve via "py") au PATH utilisateur, avant l'alias du Microsoft Store.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$dir = Split-Path (py -c 'import sys; print(sys.executable)');" ^
  "$p = [Environment]::GetEnvironmentVariable('Path','User');" ^
  "if ($p -like ('*' + $dir + ';*')) { Write-Host 'Python est deja dans le PATH :' $dir }" ^
  "else { [Environment]::SetEnvironmentVariable('Path', ($dir + ';' + $dir + '\Scripts;' + $p), 'User'); Write-Host 'Ajoute au PATH :' $dir }"
echo.
echo Ferme puis rouvre PowerShell, puis tape : python --version
pause

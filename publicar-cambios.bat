@echo off
cd /d "d:\Proyecto Codigo APP KOVO\App kovo clean"

echo.
echo ================================
echo   PUBLICAR CAMBIOS EN KOVO.SERVICES
echo ================================
echo.

set /p mensaje="Describe el cambio que hiciste: "

git add -A
git commit -m "%mensaje%"
git push origin main

echo.
echo ================================
echo  Listo! En 3-5 minutos tus cambios
echo  estaran en kovo.services
echo ================================
echo.
pause

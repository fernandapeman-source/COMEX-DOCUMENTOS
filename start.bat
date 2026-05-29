@echo off
echo.
echo  Iniciando PEMAN Comex App...
echo  Abri http://localhost:3000 en tu navegador.
echo  Para cerrar, presiona CTRL+C en esta ventana.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
pause

@echo off
echo Iniciando servidor ShipsGo MCP en http://localhost:8765/mcp
echo Presiona Ctrl+C para detener
set SHIPSGO_TOKEN=95871254-f154-4ae9-83ae-f686758cf80c
py "%~dp0server.py" http 8765
pause

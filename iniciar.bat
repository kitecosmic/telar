@echo off
rem Telar — arranca los 4 servicios, cada uno en su ventana (para ver los logs).
rem Requisito: synsema en el PATH y un .env con el provider LLM (ver .env.example).
cd /d %~dp0
start "telar · lienzo :7000" synsema serve lienzo.syn
start "telar · builder :7001" synsema serve builder.syn
start "telar · gateway :7002" synsema serve gateway.syn
start "telar · worker" synsema run worker.syn
echo Telar arrancando: lienzo http://127.0.0.1:7000 ^| builder :7001 ^| gateway :7002 ^| worker
echo Cerra cada ventana (o Ctrl+C) para frenar un servicio.
pause

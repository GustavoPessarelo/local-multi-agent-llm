@echo off
setlocal
cd /d "%~dp0app"

where node >nul 2>nul
if errorlevel 1 (
  echo [indev] Instale o Node.js 22.13 ou superior antes de continuar.
  pause
  exit /b 1
)

echo [indev] Instalando as dependencias exatas do projeto...
call npm install
if errorlevel 1 goto :error

call npm run setup
if errorlevel 1 goto :error

call npm run dev
exit /b %errorlevel%

:error
echo [indev] A inicializacao nao foi concluida.
pause
exit /b 1

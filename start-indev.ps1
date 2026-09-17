$ErrorActionPreference = "Stop"
$appPath = Join-Path $PSScriptRoot "app"
Set-Location $appPath

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Instale o Node.js 22.13 ou superior antes de continuar."
}

Write-Host "[indev] Instalando as dependencias exatas do projeto..."
npm install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npm run setup
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npm run dev
exit $LASTEXITCODE

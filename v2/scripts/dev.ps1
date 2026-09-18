$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonExe = Join-Path $projectRoot ".venv\Scripts\python.exe"
$npmExe = "C:\Program Files\nodejs\npm.cmd"

if (-not (Test-Path -LiteralPath $pythonExe)) { throw "Crie a venv em $projectRoot\.venv antes de iniciar." }
if (-not (Test-Path -LiteralPath $npmExe)) { throw "Node.js/npm não encontrado em $npmExe." }

& $pythonExe "backend\manage.py" migrate --noinput

$backendReady = $false
try { $backendReady = (Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:8000/api/health" -TimeoutSec 2).StatusCode -eq 200 } catch {}
if (-not $backendReady) {
    Start-Process -FilePath $pythonExe -ArgumentList @("backend\manage.py", "runserver", "127.0.0.1:8000", "--noreload") -WorkingDirectory $projectRoot -WindowStyle Hidden
}

$frontendReady = $false
try { $frontendReady = (Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:4200" -TimeoutSec 2).StatusCode -eq 200 } catch {}
if (-not $frontendReady) {
    Start-Process -FilePath $npmExe -ArgumentList @("run", "start") -WorkingDirectory (Join-Path $projectRoot "frontend") -WindowStyle Hidden
}

Write-Host "Local Agent Studio: http://127.0.0.1:4200"
Write-Host "Django local:      http://127.0.0.1:8000/api/health"

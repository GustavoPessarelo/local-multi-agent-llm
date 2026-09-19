$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$python314 = Join-Path $projectRoot ".venv314\Scripts\python.exe"
$pythonExe = if (Test-Path -LiteralPath $python314) { $python314 } else { Join-Path $projectRoot ".venv\Scripts\python.exe" }
$npmExe = "C:\Program Files\nodejs\npm.cmd"
$managePy = Join-Path $projectRoot "backend\manage.py"
$envFile = Join-Path $projectRoot ".env"
$lanAccess = $false
$usersCsv = Join-Path $projectRoot "data\auth\users.csv"

if (Test-Path -LiteralPath $envFile) {
    $lanSetting = Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^\s*LAN_ACCESS\s*=' } | Select-Object -Last 1
    if ($lanSetting) { $lanAccess = (($lanSetting -split '=', 2)[1].Trim().Trim('"', "'").ToLowerInvariant() -eq 'true') }
}

if (-not (Test-Path -LiteralPath $pythonExe)) { throw "Crie uma venv em $projectRoot\.venv ou $projectRoot\.venv314 antes de iniciar." }
if (-not (Test-Path -LiteralPath $npmExe)) { throw "Node.js/npm não encontrado em $npmExe." }
if (-not (Test-Path -LiteralPath $usersCsv)) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $usersCsv) -Force | Out-Null
    Set-Content -LiteralPath $usersCsv -Encoding utf8 -Value @("usuario,senha", "admin,localagent2026")
}

& $pythonExe $managePy migrate --noinput

Start-Process -FilePath $pythonExe -ArgumentList @("backend\manage.py", "run_agent_worker") -WorkingDirectory $projectRoot -WindowStyle Hidden

$backendReady = $false
try { $backendReady = (Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:8000/api/health" -TimeoutSec 2).StatusCode -eq 200 } catch {}
if (-not $backendReady) {
    Start-Process -FilePath $pythonExe -ArgumentList @("backend\manage.py", "runserver", "127.0.0.1:8000", "--noreload") -WorkingDirectory $projectRoot -WindowStyle Hidden
}

$frontendReady = $false
try { $frontendReady = (Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:4200" -TimeoutSec 2).StatusCode -eq 200 } catch {}
if (-not $frontendReady) {
    $frontendScript = if ($lanAccess) { "start:lan" } else { "start" }
    Start-Process -FilePath $npmExe -ArgumentList @("run", $frontendScript) -WorkingDirectory (Join-Path $projectRoot "frontend") -WindowStyle Hidden
}

if ($lanAccess) {
    Write-Host "Local Agent Studio (LAN): http://SEU-IP-LOCAL:4200"
} else {
    Write-Host "Local Agent Studio: http://127.0.0.1:4200"
}
Write-Host "Django local:      http://127.0.0.1:8000/api/health"
Write-Host "Worker local:      fila persistente ativa"

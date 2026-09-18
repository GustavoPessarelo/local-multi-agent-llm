$ErrorActionPreference = "Stop"
$venvPython = Join-Path $PSScriptRoot "..\..\.venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) { throw "Não encontrei .venv\\Scripts\\python.exe. Ative sua venv e instale app/python/requirements.txt." }
& $venvPython -m uvicorn indev_runtime.main:app --app-dir (Join-Path $PSScriptRoot "..\python") --host 127.0.0.1 --port 8010

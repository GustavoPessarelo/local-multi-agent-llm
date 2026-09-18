$ErrorActionPreference = "Stop"
$venvPython = Join-Path $PSScriptRoot "..\..\.venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) { throw "Não encontrei .venv\\Scripts\\python.exe." }
& $venvPython -m pip install -r (Join-Path $PSScriptRoot "..\python\requirements.txt")

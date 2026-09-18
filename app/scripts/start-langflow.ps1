$ErrorActionPreference = "Stop"

$appRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $appRoot "..\.venv\Scripts\python.exe"
$components = Join-Path $appRoot "langflow\indev_local_runtime"

if (-not (Test-Path $python)) {
  throw "Python da .venv não encontrado em $python"
}

$env:LANGFLOW_COMPONENTS_PATH = $components
$env:DO_NOT_TRACK = "true"
& $python -m langflow run --host 127.0.0.1 --port 7860

#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR/app"

if ! command -v node >/dev/null 2>&1; then
  echo "[indev] Instale o Node.js 22.13 ou superior antes de continuar." >&2
  exit 1
fi

echo "[indev] Instalando as dependências exatas do projeto..."
npm install
npm run setup
npm run dev

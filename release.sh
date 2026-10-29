#!/bin/bash
# Script de release para Chamalú Beer (usar desde Git Bash en Windows)
# Uso: ./release.sh [patch|minor|major]
#
# Hace, en orden: respaldo de data/chamalu.db, sube la versión de package.json,
# crea el commit "chore: release vX.Y.Z" y el tag anotado. No sube nada a GitHub.

set -e

cd "$(dirname "$0")"

# --- Comprobaciones previas -------------------------------------------------
if [ ! -d ".git" ]; then
  echo "ERROR: No es un repositorio git"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js no está instalado o no está en el PATH"
  exit 1
fi

TIPO=${1:-patch}
case "$TIPO" in
  patch|minor|major) ;;
  *) echo "ERROR: tipo inválido '$TIPO' (usa patch, minor o major)"; exit 1 ;;
esac

if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: hay cambios sin commitear. Commitea o guárdalos antes de hacer un release."
  git status --short
  exit 1
fi

echo "=== RELEASE CHAMALÚ BEER ==="
echo "Tipo: $TIPO"
echo ""

# --- 1. Respaldo de la base de datos real ----------------------------------
if [ -f "data/chamalu.db" ]; then
  echo "[1/5] Creando respaldo de data/chamalu.db..."
  mkdir -p data/backups
  FECHA=$(date +%Y%m%d-%H%M%S)
  DESTINO="data/backups/chamalu-$FECHA.db"
  DESTINO="$DESTINO" node -e 'const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync("data/chamalu.db");db.prepare("VACUUM INTO ?").run(process.env.DESTINO);db.close();'
  echo "  Respaldo creado: $DESTINO"
else
  echo "[1/5] No hay data/chamalu.db para respaldar (se omite)"
fi

# --- 2. Versión actual -----------------------------------------------------
VERSION_ACTUAL=$(node -p "require('./package.json').version")
echo "[2/5] Versión actual: $VERSION_ACTUAL"

# --- 3. Tags existentes y cálculo de la nueva versión ----------------------
git fetch --tags 2>/dev/null || true
echo "[3/5] Últimos tags:"
git tag -l "v*" | sort -V | tail -5 | sed 's/^/  /'

NUEVA_VERSION=$(node -e '
const [ma, me, pa] = require("./package.json").version.split(".").map(Number);
const tipo = process.argv[1];
if (tipo === "major") console.log((ma + 1) + ".0.0");
else if (tipo === "minor") console.log(ma + "." + (me + 1) + ".0");
else console.log(ma + "." + me + "." + (pa + 1));
' "$TIPO")
TAG_NUEVO="v$NUEVA_VERSION"

if git rev-parse "$TAG_NUEVO" >/dev/null 2>&1; then
  echo "ERROR: El tag $TAG_NUEVO ya existe en local"
  exit 1
fi
if [ -n "$(git ls-remote --tags origin "refs/tags/$TAG_NUEVO" 2>/dev/null)" ]; then
  echo "ERROR: El tag $TAG_NUEVO ya existe en origin"
  exit 1
fi

echo "  Nueva versión propuesta: $NUEVA_VERSION ($TAG_NUEVO)"

# --- 4. Confirmación -------------------------------------------------------
read -p "¿Continuar con $TIPO ($NUEVA_VERSION)? (s/N): " CONFIRM
if [ "$CONFIRM" != "s" ] && [ "$CONFIRM" != "S" ]; then
  echo "Cancelado"
  exit 0
fi

echo "[4/5] Actualizando versión..."
npm version "$TIPO" --no-git-tag-version

# --- 5. Commit y tag -------------------------------------------------------
echo "[5/5] Creando commit y tag..."
git add package.json package-lock.json 2>/dev/null || git add package.json
git commit -m "chore: release v$NUEVA_VERSION"
git tag -a "$TAG_NUEVO" -m "Release $TAG_NUEVO"

echo ""
echo "=== RELEASE COMPLETADO ==="
echo "Versión: $NUEVA_VERSION"
echo "Tag: $TAG_NUEVO"
echo ""
echo "Para publicar (recuerda: push a main despliega en Vercel):"
echo "  git push origin main && git push origin $TAG_NUEVO"

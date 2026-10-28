#!/bin/bash
# Script de release para Chamalú Beer
# Uso: ./release.sh [patch|minor|major]

set -e

# Verificar que estamos en un repo git
if [ ! -d ".git" ]; then
  echo "ERROR: No es un repositorio git"
  exit 1
fi

# Tipo de release
TIPO=${1:-patch}

echo "=== RELEASE CHAMALÚ BEER ==="
echo "Tipo: $TIPO"
echo ""

# Crear respaldo de la base de datos si existe
if [ -f "data/chamalu.db" ]; then
  echo "[1/5] Creando respaldo..."
  mkdir -p backups
  FECHA=$(date +%Y%m%d-%H%M%S)
  cp data/chamalu.db "backups/chamalu-$FECHA.db"
  echo "  Respaldo creado: backups/chamalu-$FECHA.db"
else
  echo "[1/5] No hay data/chamalu.db para respaldar"
fi

# Leer versión actual
VERSION_ACTUAL=$(node -p "require('./package.json').version")
echo "[2/5] Versión actual: $VERSION_ACTUAL"

# Obtener tags existentes
git fetch --tags 2>/dev/null || true
TAGS=$(git tag -l "v*" | tail -5)
echo "[3/5] Tags existentes:"
echo "$TAGS" | sed 's/^/  /'

# Verificar que el tag de la nueva versión no exista
# Simular nueva versión
NUEVA_VERSION=$(node -e "
const semver = require('semver');
const v = require('./package.json').version;
console.log(semver.inc(v, process.argv[1]));
" $TIPO)
TAG_NUEVO="v$NUEVA_VERSION"

if git rev-parse "$TAG_NUEVO" >/dev/null 2>&1; then
  echo "ERROR: El tag $TAG_NUEVO ya existe"
  exit 1
fi

echo "  Nueva versión propuesta: $NUEVA_VERSION ($TAG_NUEVO)"

# Confirmación
read -p "¿Continuar con $TIPO ($NUEVA_VERSION)? (s/N): " CONFIRM
if [ "$CONFIRM" != "s" ] && [ "$CONFIRM" != "S" ]; then
  echo "Cancelado"
  exit 0
fi

# Actualizar versión con npm version (solo cambia package.json, no hace commit automático si hay cambios)
echo "[4/5] Actualizando versión..."
npm version $TIPO --no-git-tag-version

# Commit y tag
echo "[5/5] Creando commit y tag..."
git add package.json
git commit -m "chore: release v$NUEVA_VERSION" || echo "  (sin cambios para commit)"
git tag -a "$TAG_NUEVO" -m "Release $TAG_NUEVO"

echo ""
echo "=== RELEASE COMPLETADO ==="
echo "Versión: $NUEVA_VERSION"
echo "Tag: $TAG_NUEVO"
echo ""
echo "Para subir: git push && git push --tags"

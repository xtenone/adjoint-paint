#!/bin/sh
# Export every finished (reconstructed) case for the viewer.
# Usage: tools/export_all.sh <data dir>      (default: viewer/data)
set -e
cd "$(dirname "$0")/.."
OUT=${1:-viewer/data}
mkdir -p "$OUT"

index=""
add() {  # add <case> <title> <patch> <export options...>
    case=$1; title=$2; patch=$3; shift 3
    if [ -f "cases/$case/log.adjointOptimisationFoam" ]; then
        if python3 tools/export_surface.py "cases/$case" "$patch" "$OUT/$case.json" --title "$title" "$@"; then
            index="$index{\"id\":\"$case\",\"title\":\"$title\"},"
        fi
    fi
}
add sphere-drag "Bol in stroming (Re 100), minimale weerstand" sphere --body --unit-label D --flow 1 0 0 --values drag
add pipe-bend "Buisbocht 90° (laminair), minimaal drukverlies" bend --unit-label mm --unit-scale 1000 --flow 1 0 0 --values losses

echo "[${index%,}]" > "$OUT/index.json"

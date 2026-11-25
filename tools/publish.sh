#!/bin/sh
# Export finished cases and copy the viewer to a web-served directory.
# Usage: tools/publish.sh <target dir>
# Cases must be reconstructed (reconstructPar) before exporting.
set -e
TARGET=${1:?usage: tools/publish.sh <target dir>}
cd "$(dirname "$0")/.."

mkdir -p "$TARGET/data" "$TARGET/vendor"
cp viewer/index.html viewer/app.js viewer/style.css "$TARGET/"
cp viewer/vendor/* "$TARGET/vendor/"

index=""
add() {  # add <case> <title> <patch> <export options...>
    case=$1; title=$2; patch=$3; shift 3
    if [ -f "cases/$case/log.adjointOptimisationFoam" ]; then
        if python3 tools/export_surface.py "cases/$case" "$patch" "$TARGET/data/$case.json" --title "$title" "$@"; then
            index="$index{\"id\":\"$case\",\"title\":\"$title\"},"
        fi
    fi
}
add sphere-drag "Bol in stroming (Re 100), minimale weerstand" sphere --body --unit-label D --flow 1 0 0 --values drag
add pipe-bend "Buisbocht 90° (laminair), minimaal drukverlies" bend --unit-label mm --unit-scale 1000 --flow 1 0 0 --values losses

echo "[${index%,}]" > "$TARGET/data/index.json"
echo "published to $TARGET"

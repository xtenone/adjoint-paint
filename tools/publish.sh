#!/bin/sh
# Copy the viewer plus exported case data to a static web directory
# (view only: painting needs the viewer server, see server/).
# Usage: tools/publish.sh <target dir>
set -e
TARGET=${1:?usage: tools/publish.sh <target dir>}
cd "$(dirname "$0")/.."
mkdir -p "$TARGET/vendor"
cp viewer/index.html viewer/app.js viewer/style.css "$TARGET/"
cp viewer/vendor/* "$TARGET/vendor/"
tools/export_all.sh "$TARGET/data"
echo "published to $TARGET"

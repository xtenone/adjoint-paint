#!/bin/sh
# Install the viewer server as a podman Quadlet user service.
# Usage: deploy/install.sh [port]      (default 8500)
set -e
PORT=${1:-8500}
REPO=$(cd "$(dirname "$0")/.." && pwd)
DEST="$HOME/.config/containers/systemd"
mkdir -p "$DEST"
sed -e "s|@REPO@|$REPO|g" -e "s|@PORT@|$PORT|g" \
    "$REPO/deploy/adjoint-paint-viewer.container.in" > "$DEST/adjoint-paint-viewer.container"
"$REPO/tools/export_all.sh"
systemctl --user daemon-reload
systemctl --user restart adjoint-paint-viewer.service
echo "viewer on port $PORT"

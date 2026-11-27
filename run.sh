#!/bin/sh
# Run a case inside the OpenFOAM (ESI) container.
# Usage: ./run.sh cases/<case>
#
# Cases with an Allrun.pre (mesh generation) get their paint turned into
# control-point bounds between Allrun.pre and Allrun; that step runs on the
# host because the OpenFOAM image has no Python.
set -e
cd "$(dirname "$0")"
IMAGE=docker.io/opencfd/openfoam-default:2506
NAME=$(basename "${1:?usage: ./run.sh cases/<case>}")
foam() {
    podman run --rm \
        -e OMPI_ALLOW_RUN_AS_ROOT=1 -e OMPI_ALLOW_RUN_AS_ROOT_CONFIRM=1 \
        -v "$PWD/cases:/cases:Z" "$IMAGE" \
        bash -lc "cd /cases/$NAME && $1"
}
if [ -x "cases/$NAME/Allrun.pre" ]; then
    foam "./Allclean && ./Allrun.pre"
    python3 tools/paint_to_bounds.py "cases/$NAME"
    foam "./Allrun"
else
    foam "./Allclean && ./Allrun"
fi

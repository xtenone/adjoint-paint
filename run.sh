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
        -v "$PWD/cases:/cases:Z" -v "$PWD/src:/src:Z" "$IMAGE" \
        bash -lc "cd /cases/$NAME && $1"
}
if [ -x "cases/$NAME/Allrun.pre" ]; then
    foam "./Allclean && ./Allrun.pre"
    python3 tools/paint_to_bounds.py "cases/$NAME"
    foam "./Allrun"
else
    foam "./Allclean && ./Allrun"
fi

# OpenFOAM's run functions do not pass on a solver crash; look in the logs.
# ("trapFpe: Floating point exception trapping enabled" is a normal start-up line.)
if grep -lE "FOAM FATAL|Signal: |exited on signal" "cases/$NAME"/log.* 2>/dev/null; then
    echo "run.sh: $NAME failed, see the log file(s) above" >&2
    exit 1
fi

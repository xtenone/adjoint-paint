#!/bin/sh
# Run a case's Allrun inside the OpenFOAM (ESI) container.
# Usage: ./run.sh cases/<case>
set -e
IMAGE=docker.io/opencfd/openfoam-default:2506
CASE=${1:?usage: ./run.sh cases/<case>}
podman run --rm \
    -e OMPI_ALLOW_RUN_AS_ROOT=1 -e OMPI_ALLOW_RUN_AS_ROOT_CONFIRM=1 \
    -v "$PWD/cases:/cases:Z" "$IMAGE" \
    bash -lc "cd /cases/$(basename "$CASE") && ./Allclean && ./Allrun"

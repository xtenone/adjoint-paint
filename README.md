# adjoint-paint

Adjoint shape optimisation of pipe flow (OpenFOAM, ESI line) with a browser
viewer in which the user paints, on the 3D surface, where the shape may
deform and how strongly. Changes between optimisation cycles are shown in
the same viewer.

## Layout

- `cases/` — OpenFOAM cases
  - `sbend-tutorial/` — unmodified ESI tutorial (2D S-bend duct, total
    pressure losses, BFGS, 5 cycles); used to verify the toolchain
- `run.sh` — runs a case inside the `opencfd/openfoam-default` container (podman)

## Running

    ./run.sh cases/sbend-tutorial

Results land in the case directory (`processor*/`, `optimisation/`, logs).

## Licence

GPL-3.0 (see `LICENSE`). The files under `cases/sbend-tutorial/` are taken
from the OpenFOAM (ESI, v2506) tutorials, which are also GPL-3.0.

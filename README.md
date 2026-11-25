# adjoint-paint

Adjoint shape optimisation (OpenFOAM, ESI line) with a browser viewer in
which the user paints, on the 3D surface, where the shape may deform and how
strongly. Changes between optimisation cycles are shown in the same viewer.

## Layout

- `cases/` — OpenFOAM cases
  - `sbend-tutorial/` — unmodified ESI tutorial (2D S-bend duct, total
    pressure losses, BFGS, 5 cycles); used to verify the toolchain
  - `pipe-bend/` — 3D round pipe (D = 10 mm) with a 90° bend (R = 15 mm),
    laminar air at 1 m/s (Re ≈ 670), total pressure losses, volumetric
    B-spline morphing box around the bend
  - `sphere-drag/` — sphere (D = 1) in a uniform flow, Re = 100, laminar;
    minimises the drag coefficient while the enclosed volume may not drop
    below that of the sphere (ISQP with a `partialVolume` constraint)
- `run.sh` — runs a case inside the `opencfd/openfoam-default` container (podman)
- `tools/make_pipe_mesh.py` — writes the O-grid `blockMeshDict` for `pipe-bend`
- `tools/make_sphere_mesh.py` — writes the six-block spherical-shell
  `blockMeshDict` for `sphere-drag` (body and far field projected onto spheres)
- `tools/export_surface.py` — exports one patch per optimisation cycle
  (positions, logged objective values, enclosed volume) to JSON
- `tools/publish.sh` — exports the finished cases and copies the viewer to a
  web-served directory
- `viewer/` — static browser viewer (three.js): steps through the cycles,
  colours the surface by normal displacement (vs. the start or the previous
  cycle, on a fixed scale over all cycles), shows the initial shape as a
  ghost, and plots objective and volume per cycle

## Running

    ./run.sh cases/sbend-tutorial
    ./run.sh cases/pipe-bend
    ./run.sh cases/sphere-drag

Results land in the case directory (`processor*/`, `optimisation/`, logs).
To view them, reconstruct and publish:

    podman run --rm -v $PWD/cases:/cases:Z docker.io/opencfd/openfoam-default:2506 \
        bash -lc 'cd /cases/sphere-drag && reconstructPar'
    tools/publish.sh <web-served directory>

The viewer is plain static files; any web server will do (`python3 -m
http.server` in the target directory works for a quick look).

## Licence

GPL-3.0 (see `LICENSE`). The files under `cases/sbend-tutorial/` are taken
from the OpenFOAM (ESI, v2506) tutorials, which are also GPL-3.0.
`viewer/vendor/` contains three.js (MIT, see `viewer/vendor/three-LICENSE`).

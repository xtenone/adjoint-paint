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
  - `sphere-rear/` — the same with paint: only the rear half is allowed to
    deform (test case with a predictable outcome)
- `run.sh` — runs a case inside the `opencfd/openfoam-default` container (podman)
- `tools/make_pipe_mesh.py` — writes the O-grid `blockMeshDict` for `pipe-bend`
- `tools/make_sphere_mesh.py` — writes the six-block spherical-shell
  `blockMeshDict` for `sphere-drag` (body and far field projected onto spheres)
- `tools/export_surface.py` — exports one patch per optimisation cycle
  (positions, logged objective values, enclosed volume, morphing-box
  parametric coordinates) to JSON
- `tools/paint_to_bounds.py` — turns a case's *allowed* paint into
  control-point bounds (`system/paintBounds`), see below
- `src/paintedConstraint/` — OpenFOAM library with the `painted`
  morphing-box constraint that applies those bounds
- `tools/export_all.sh` — exports every finished case to `viewer/data/`
- `tools/publish.sh` — copies a view-only viewer plus data to any static
  web directory
- `viewer/` — browser viewer (three.js): steps through the cycles, colours
  the surface by normal displacement (vs. the start or the previous cycle, on
  a fixed scale over all cycles), shows the initial shape as a ghost, plots
  objective and volume per cycle, and has two airbrush channels to paint on
  the surface:
  - *allowed* — how far the shape may move here (0 = fixed, 1 = free)
  - *priority* — where the optimisation should take larger steps
- `server/app.py` — serves the viewer and stores paint per case in
  `cases/<case>/paint.json` (standard library only)
- `deploy/` — podman Quadlet unit for the server and its installer

## Running

    ./run.sh cases/sbend-tutorial
    ./run.sh cases/pipe-bend
    ./run.sh cases/sphere-drag

Results land in the case directory (`processor*/`, `optimisation/`, logs).
To view them, reconstruct and export:

    podman run --rm -v $PWD/cases:/cases:Z docker.io/opencfd/openfoam-default:2506 \
        bash -lc 'cd /cases/sphere-drag && reconstructPar'
    tools/export_all.sh

## Viewer server

    python3 server/app.py              # http://localhost:8500/

or as a podman user service that starts at boot:

    deploy/install.sh [port]

Painting: pick *Toegestaan* or *Voorkeur*, then hold the left mouse button
(or one finger) to spray; rotate with the right button (or two fingers).
Shift or the *Gum* toggle erases. Paint is saved automatically.

## How paint reaches the optimisation

The shape is parametrised by a volumetric B-spline morphing box, so paint
cannot act per surface point; it acts per control point:

1. `paint_to_bounds.py` averages the *allowed* paint onto each control point,
   weighted by the control point's basis function at each painted point
   (`w`, 0..1). A control point may move at most `w * maxDisplacement`
   (`system/paintDict`) per direction from its initial position. Nothing
   painted means unrestricted.
2. `src/paintedConstraint` keeps OpenFOAM's own non-overlapping bounds
   (between the midpoints to the neighbouring control points, moving each
   cycle, so the box cannot fold) and clips them to those fixed paint bounds.
3. `run.sh` runs `Allrun.pre` (mesh), then `paint_to_bounds.py` on the host,
   then `Allrun`, which builds the library and passes it to the solver
   (`-lib`).

Because each control point influences a region several control-point
spacings wide, the paint is blurred; the viewer's colour mode *Toegestaan,
effectief* shows what the optimisation actually gets. A denser control
point grid sharpens it. *Priority* paint is stored but not used yet.

## Licence

GPL-3.0 (see `LICENSE`). The files under `cases/sbend-tutorial/` are taken
from the OpenFOAM (ESI, v2506) tutorials, which are also GPL-3.0.
`viewer/vendor/` contains three.js (MIT, see `viewer/vendor/three-LICENSE`).

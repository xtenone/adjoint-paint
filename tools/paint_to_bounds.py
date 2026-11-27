#!/usr/bin/env python3
"""Turn the 'allowed' paint of a case into control-point bounds.

The paint (cases/<case>/paint.json, one weight in [0, 1] per point of the
painted patch, as stored by the viewer) is averaged onto the control points
of the volumetric B-spline morphing box, each surface point weighted by the
basis function of the control point at that point. A control point with
weight w may then move at most w * maxDisplacement from its initial position
in each direction. Control points that influence no painted point get w = 0.
An 'allowed' channel that is zero everywhere counts as not painted.

The result is written to system/paintBounds, which optimisationDict includes
if present (absolute lowerBounds/upperBounds per design variable, with
updateBounds off so they stay fixed for the whole run). Without paint, or
without an 'allowed' channel, system/paintBounds is removed.

maxDisplacement comes from system/paintDict (case length units).

Usage: paint_to_bounds.py <case dir>
       paint_to_bounds.py <case dir> --check <time> --patch <patch>
           compare the parametric coordinates computed here with OpenFOAM's
           for that time directory
"""
import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from export_surface import NUM, body, read_faces, read_patch, read_points, read_text  # noqa: E402


# ---------------------------------------------------------------- B-splines
def knots(n_cps, degree):
    """Clamped uniform knot vector, as OpenFOAM's NURBSbasis."""
    inner = n_cps - degree - 1
    return [0.0] * (degree + 1) + [(k + 1) / (inner + 1) for k in range(inner)] + [1.0] * (degree + 1)


def basis(u, n_cps, degree, kv):
    """All n_cps basis function values at u (Cox-de Boor)."""
    u = min(u, 1.0 - 1e-12)  # u = 1 belongs to the last span
    n = [1.0 if kv[i] <= u < kv[i + 1] else 0.0 for i in range(n_cps + degree)]
    for p in range(1, degree + 1):
        for i in range(n_cps + degree - p):
            a = b = 0.0
            d1 = kv[i + p] - kv[i]
            d2 = kv[i + p + 1] - kv[i + 1]
            if d1 > 0:
                a = (u - kv[i]) / d1 * n[i]
            if d2 > 0:
                b = (kv[i + p + 1] - u) / d2 * n[i + 1]
            n[i] = a + b
    return n[:n_cps]


def invert(x, cps, degree, kv):
    """Parametric coordinate u with sum N_i(u) cps_i = x (monotone axis)."""
    lo, hi = 0.0, 1.0
    f = lambda u: sum(b * c for b, c in zip(basis(u, len(cps), degree, kv), cps))  # noqa: E731
    for _ in range(60):
        mid = 0.5 * (lo + hi)
        if f(mid) < x:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


# ---------------------------------------------------------------- case input
def read_box(case):
    """The single cartesian, axis-aligned box of constant/dynamicMeshDict."""
    txt = body(read_text(os.path.join(case, "constant/dynamicMeshDict")))
    coeffs = txt[txt.index("volumetricBSplinesMotionSolverCoeffs"):]
    get = lambda key: re.search(r"\b%s\s+(\d+);" % key, coeffs).group(1)  # noqa: E731
    vec = lambda key: [float(v) for v in re.search(  # noqa: E731
        r"\b%s\s+\(\s*(%s)\s+(%s)\s+(%s)\s*\)" % (key, NUM, NUM, NUM), coeffs).groups()]
    name = re.search(r"\n\s*(\w+)\s*\n\s*\{\s*\n\s*type\s+cartesian;", coeffs)
    if not name or "axisAligned" not in coeffs:
        sys.exit("only a single cartesian axisAligned box is supported")
    n = [int(get("nCPs" + d)) for d in "UVW"]
    deg = [int(get("degree" + d)) for d in "UVW"]
    lo, hi = vec("lowerCpBounds"), vec("upperCpBounds")
    axes = [[lo[a] + (hi[a] - lo[a]) * i / (n[a] - 1) for i in range(n[a])] for a in range(3)]
    return {"name": name.group(1), "n": n, "degree": deg, "axes": axes,
            "knots": [knots(n[a], deg[a]) for a in range(3)]}


def read_max_displacement(case):
    txt = body(read_text(os.path.join(case, "system/paintDict")))
    return float(re.search(r"\bmaxDisplacement\s+(%s);" % NUM, txt).group(1))


def patch_points(case, patch):
    """Initial coordinates of the patch points, in the viewer's order."""
    start, n = read_patch(case, patch)
    faces = read_faces(case, start, n)
    local = {}
    for f in faces:
        for p in f:
            local.setdefault(p, len(local))
    order = sorted(local, key=local.get)
    pts = read_points(os.path.join(case, "constant/polyMesh/points"))
    return order, [pts[p] for p in order]


def parametric(box, point):
    return [invert(point[a], box["axes"][a], box["degree"][a], box["knots"][a]) for a in range(3)]


def inside(box, point):
    return all(box["axes"][a][0] <= point[a] <= box["axes"][a][-1] for a in range(3))


# ---------------------------------------------------------------- main
def control_point_weights(box, points, allowed):
    nu, nv, nw = box["n"]
    num = [0.0] * (nu * nv * nw)
    den = [0.0] * (nu * nv * nw)
    for pt, a in zip(points, allowed):
        if not inside(box, pt):
            continue
        u = parametric(box, pt)
        bu, bv, bw = (basis(u[k], box["n"][k], box["degree"][k], box["knots"][k]) for k in range(3))
        for k in range(nw):
            if bw[k] == 0.0:
                continue
            for j in range(nv):
                if bv[j] == 0.0:
                    continue
                for i in range(nu):
                    if bu[i] == 0.0:
                        continue
                    b = bu[i] * bv[j] * bw[k]
                    cp = i + j * nu + k * nu * nv
                    num[cp] += b * a
                    den[cp] += b
    return [n / d if d > 1e-12 else 0.0 for n, d in zip(num, den)]


def write_bounds(case, box, weights, max_disp):
    nu, nv = box["n"][0], box["n"][1]
    lower, upper = [], []
    for cp, w in enumerate(weights):
        i, j, k = cp % nu, (cp // nu) % nv, cp // (nu * nv)
        c = (box["axes"][0][i], box["axes"][1][j], box["axes"][2][k])
        for x in c:
            lower.append(x - w * max_disp)
            upper.append(x + w * max_disp)
    fmt = lambda vals: "%d\n(\n%s\n)" % (len(vals), "\n".join("%.9g" % v for v in vals))  # noqa: E731
    out = ("// Generated by tools/paint_to_bounds.py from paint.json - do not edit\n"
           "// Absolute bounds per design variable (x y z per control point),\n"
           "// fixed for the whole run.\n"
           "nonOverlappingCPs false;\n"
           "updateBounds      false;\n"
           "lowerBounds %s;\n"
           "upperBounds %s;\n") % (fmt(lower), fmt(upper))
    with open(os.path.join(case, "system/paintBounds"), "w") as fh:
        fh.write(out)


def check(case, box, patch, time):
    """Max difference between our and OpenFOAM's parametric coordinates."""
    order, points = patch_points(case, patch)
    path = os.path.join(case, time, "parametricCoordinates" + box["name"])
    txt = body(read_text(path))
    vals = re.findall(r"\((%s) (%s) (%s)\)" % (NUM, NUM, NUM), txt)
    worst = 0.0
    for p, pt in zip(order, points):
        if not inside(box, pt):
            continue
        ref = [float(v) for v in vals[p]]
        worst = max(worst, max(abs(a - b) for a, b in zip(parametric(box, pt), ref)))
    print("max |u - u_OpenFOAM| over %d patch points: %.2e" % (len(points), worst))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("case")
    ap.add_argument("--check", metavar="TIME")
    ap.add_argument("--patch", help="patch for --check")
    args = ap.parse_args()
    case = args.case
    box = read_box(case)
    if args.check:
        return check(case, box, args.patch, args.check)
    target = os.path.join(case, "system/paintBounds")
    paint_file = os.path.join(case, "paint.json")

    if not os.path.exists(paint_file):
        if os.path.exists(target):
            os.remove(target)
        print("%s: no paint, optimisation unrestricted" % case)
        return
    paint = json.load(open(paint_file))

    allowed = paint["channels"].get("allowed")
    # Nothing painted as allowed means unrestricted, as the viewer says
    if allowed is None or max(allowed) == 0:
        if os.path.exists(target):
            os.remove(target)
        print("%s: no 'allowed' paint, optimisation unrestricted" % case)
        return
    order, points = patch_points(case, paint["patch"])
    if len(points) != paint["nPoints"]:
        sys.exit("paint.json has %d points, patch %s has %d: paint belongs to another mesh"
                 % (paint["nPoints"], paint["patch"], len(points)))
    weights = control_point_weights(box, points, allowed)
    max_disp = read_max_displacement(case)
    write_bounds(case, box, weights, max_disp)
    free = sum(w > 0.99 for w in weights)
    part = sum(0.01 < w <= 0.99 for w in weights)
    print("%s: %d control points free, %d partly, %d fixed (max displacement %g)"
          % (case, free, part, len(weights) - free - part, max_disp))


if __name__ == "__main__":
    main()

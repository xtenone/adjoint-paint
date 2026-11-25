#!/usr/bin/env python3
"""Export one boundary patch of a reconstructed optimisation case to JSON.

For every optimisation cycle (time directory) the patch point positions are
written, together with the objective and constraint values read from the
solver log, so a viewer can step through the cycles.

The geometry at time t is the one the flow was solved on in cycle t; times
without their own polyMesh/points use constant/polyMesh/points.

Usage: export_surface.py <case dir> <patch> <output.json> [options]
       (see --help)
"""
import argparse
import gzip
import json
import os
import re
import sys

NUM = r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?"


def read_text(path):
    if os.path.exists(path):
        return open(path).read()
    with gzip.open(path + ".gz", "rt") as fh:
        return fh.read()


def body(text):
    """Text after the FoamFile header."""
    i = text.index("FoamFile")
    return text[text.index("}", i) + 1:]


def read_points(path):
    txt = body(read_text(path))
    vals = re.findall(r"\((%s) (%s) (%s)\)" % (NUM, NUM, NUM), txt)
    return [(float(x), float(y), float(z)) for x, y, z in vals]


def read_patch(case, patch):
    txt = body(read_text(os.path.join(case, "constant/polyMesh/boundary")))
    m = re.search(r"\b%s\s*\{([^}]*)\}" % re.escape(patch), txt)
    if not m:
        sys.exit("patch %s not found" % patch)
    n = int(re.search(r"nFaces\s+(\d+);", m.group(1)).group(1))
    start = int(re.search(r"startFace\s+(\d+);", m.group(1)).group(1))
    return start, n


def read_faces(case, start, n):
    txt = body(read_text(os.path.join(case, "constant/polyMesh/faces")))
    if "faceCompactList" in read_text(os.path.join(case, "constant/polyMesh/faces"))[:600]:
        sys.exit("faceCompactList format not supported")
    faces = re.findall(r"\d+\(([\d ]+)\)", txt)
    return [list(map(int, f.split())) for f in faces[start:start + n]]


def log_values(case, names):
    """Last value of each 'name : value' line per optimisation cycle."""
    path = os.path.join(case, "log.adjointOptimisationFoam")
    values, current = [], None
    for line in open(path):
        if line.startswith("Optimisation cycle"):
            if current is not None:
                values.append(current)
            current = {}
        elif current is not None:
            for name in names:
                m = re.match(r"^%s\s*:\s*(%s)" % (re.escape(name), NUM), line)
                if m:
                    current[name] = float(m.group(1))
    if current:
        values.append(current)
    return values


def enclosed_volume(flat, triangles):
    """Volume enclosed by a closed triangulated surface (divergence theorem)."""
    v = 0.0
    for k in range(0, len(triangles), 3):
        a, b, c = (flat[3 * i:3 * i + 3] for i in triangles[k:k + 3])
        v += (a[0] * (b[1] * c[2] - b[2] * c[1])
              - a[1] * (b[0] * c[2] - b[2] * c[0])
              + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6.0
    return abs(v)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("case")
    ap.add_argument("patch")
    ap.add_argument("out")
    ap.add_argument("--values", nargs="+", default=["drag", "vol"],
                    help="names of 'name : value' log lines to collect per cycle")
    ap.add_argument("--title", default="")
    ap.add_argument("--body", action="store_true",
                    help="patch is a closed body in the flow: outward = into the fluid, "
                         "and the enclosed volume is reported")
    ap.add_argument("--unit-label", default="m")
    ap.add_argument("--unit-scale", type=float, default=1.0,
                    help="multiply coordinates by this for display in --unit-label")
    ap.add_argument("--flow", nargs=3, type=float, default=None, help="free-stream direction")
    args = ap.parse_args()
    case, patch, out = args.case, args.patch, args.out

    start, n = read_patch(case, patch)
    faces = read_faces(case, start, n)

    # Local numbering of the patch points
    local = {}
    for f in faces:
        for p in f:
            local.setdefault(p, len(local))
    order = sorted(local, key=local.get)
    triangles = []
    for f in faces:
        lf = [local[p] for p in f]
        for k in range(1, len(lf) - 1):
            triangles += [lf[0], lf[k], lf[k + 1]]

    times = sorted((d for d in os.listdir(case) if re.fullmatch(NUM, d) and d != "0"), key=float)
    base = read_points(os.path.join(case, "constant/polyMesh/points"))
    logged = log_values(case, args.values)

    cycles = []
    for i, t in enumerate(times):
        pfile = os.path.join(case, t, "polyMesh/points")
        pts = read_points(pfile) if os.path.exists(pfile) or os.path.exists(pfile + ".gz") else base
        flat = []
        for p in order:
            flat += [round(c * args.unit_scale, 6) for c in pts[p]]
        cycle = {"cycle": i + 1, "time": t, "positions": flat,
                 "values": logged[i] if i < len(logged) else {}}
        if args.body:
            cycle["volume"] = enclosed_volume(flat, triangles)
        cycles.append(cycle)

    if not cycles:
        sys.exit("%s: no time directories (run reconstructPar first)" % case)

    data = {
        "title": args.title or os.path.basename(os.path.normpath(case)),
        "patch": patch,
        "unit": args.unit_label,
        # OpenFOAM boundary faces point out of the fluid: into a body, away
        # from the fluid for a duct wall. "outwardSign" turns that into
        # "outward" as a viewer would say it.
        "outwardSign": -1 if args.body else 1,
        "body": args.body,
        "flow": args.flow,
        "nPoints": len(order),
        "triangles": triangles,
        "cycles": cycles,
    }
    with open(out, "w") as fh:
        json.dump(data, fh, separators=(",", ":"))
    print("%s: %d points, %d triangles, %d cycles" % (out, len(order), len(triangles) // 3, len(cycles)))


if __name__ == "__main__":
    main()

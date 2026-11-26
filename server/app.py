#!/usr/bin/env python3
"""Viewer server: static viewer + exported case data + paint storage.

  GET  /                       viewer (viewer/)
  GET  /data/...               exported case data (viewer/data/)
  GET  /api/paint/<case>       paint of a case (cases/<case>/paint.json), null if none
  PUT  /api/paint/<case>       store paint for a case

Standard library only. Usage: app.py [--port 8500] [--root <repo dir>]
"""
import argparse
import functools
import json
import os
import re
import tempfile
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

CASE_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
CHANNELS = ("allowed", "priority")
MAX_BODY = 4 * 1024 * 1024


def validate_paint(payload):
    """Return a clean paint dict or raise ValueError."""
    if not isinstance(payload, dict):
        raise ValueError("payload must be an object")
    n = payload.get("nPoints")
    if not isinstance(n, int) or not 0 < n <= 1_000_000:
        raise ValueError("nPoints must be a positive integer")
    patch = payload.get("patch")
    if not isinstance(patch, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", patch):
        raise ValueError("patch must be a patch name")
    channels = payload.get("channels")
    if not isinstance(channels, dict):
        raise ValueError("channels must be an object")
    clean = {}
    for name in CHANNELS:
        values = channels.get(name)
        if values is None:
            continue
        if not isinstance(values, list) or len(values) != n:
            raise ValueError("channel %s must have nPoints values" % name)
        row = []
        for v in values:
            if not isinstance(v, (int, float)) or isinstance(v, bool) or not 0 <= v <= 1:
                raise ValueError("channel %s values must be numbers in [0, 1]" % name)
            row.append(round(float(v), 3))
        clean[name] = row
    return {"patch": patch, "nPoints": n, "channels": clean}


class Handler(SimpleHTTPRequestHandler):
    root = "."

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def _case_dir(self):
        m = re.fullmatch(r"/api/paint/([^/?]+)", self.path.split("?")[0])
        if not m or not CASE_RE.fullmatch(m.group(1)):
            return None
        d = os.path.join(self.root, "cases", m.group(1))
        return d if os.path.isdir(d) else None

    def _json(self, status, obj):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/api/"):
            d = self._case_dir()
            if d is None:
                return self._json(HTTPStatus.NOT_FOUND, {"error": "unknown case"})
            path = os.path.join(d, "paint.json")
            if not os.path.exists(path):
                return self._json(HTTPStatus.OK, None)
            with open(path) as fh:
                return self._json(HTTPStatus.OK, json.load(fh))
        return super().do_GET()

    def do_PUT(self):
        d = self._case_dir()
        if d is None:
            return self._json(HTTPStatus.NOT_FOUND, {"error": "unknown case"})
        length = int(self.headers.get("Content-Length") or 0)
        if not 0 < length <= MAX_BODY:
            return self._json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "bad size"})
        try:
            paint = validate_paint(json.loads(self.rfile.read(length)))
        except (ValueError, json.JSONDecodeError) as e:
            return self._json(HTTPStatus.BAD_REQUEST, {"error": str(e)})
        # Atomic write: never leave a half-written paint file behind
        fd, tmp = tempfile.mkstemp(dir=d, prefix=".paint-", suffix=".json")
        with os.fdopen(fd, "w") as fh:
            json.dump(paint, fh, separators=(",", ":"))
        os.chmod(tmp, 0o644)
        os.replace(tmp, os.path.join(d, "paint.json"))
        return self._json(HTTPStatus.OK, {"saved": True})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8500)
    ap.add_argument("--root", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    args = ap.parse_args()
    Handler.root = os.path.abspath(args.root)
    # Static files come from viewer/ only
    handler = functools.partial(Handler, directory=os.path.join(Handler.root, "viewer"))
    server = ThreadingHTTPServer(("0.0.0.0", args.port), handler)
    print("serving %s on :%d" % (Handler.root, args.port), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()

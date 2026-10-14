"""Build web/data/routes.json from the scraped output for the route finder app.

Usage:
    python web/build_data.py [path/to/vandreruter_<region>.json]
"""

import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "output" / "vandreruter_sjaelland.json"
DST = Path(__file__).resolve().parent / "data" / "routes.json"

SIMPLIFY_TOLERANCE = 0.00005  # degrees, roughly 3-5 m
ELEVATION_SAMPLES = 60


def haversine_m(a, b):
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


def simplify(points, tol):
    """Douglas-Peucker on [lon, lat] points."""
    if len(points) < 3:
        return points
    (x1, y1), (x2, y2) = points[0], points[-1]
    dx, dy = x2 - x1, y2 - y1
    norm = math.hypot(dx, dy)
    best_i, best_d = 0, -1.0
    for i in range(1, len(points) - 1):
        px, py = points[i]
        d = abs(dy * px - dx * py + x2 * y1 - y2 * x1) / norm if norm else math.hypot(px - x1, py - y1)
        if d > best_d:
            best_i, best_d = i, d
    if best_d <= tol:
        return [points[0], points[-1]]
    return simplify(points[: best_i + 1], tol)[:-1] + simplify(points[best_i:], tol)


def encode_polyline(points):
    """Google encoded polyline from [lon, lat] points."""
    out, prev_lat, prev_lon = [], 0, 0
    for lon, lat in points:
        lat_i, lon_i = round(lat * 1e5), round(lon * 1e5)
        for v in (lat_i - prev_lat, lon_i - prev_lon):
            v = ~(v << 1) if v < 0 else v << 1
            while v >= 0x20:
                out.append(chr((0x20 | (v & 0x1F)) + 63))
                v >>= 5
            out.append(chr(v + 63))
        prev_lat, prev_lon = lat_i, lon_i
    return "".join(out)


def sample(values, n):
    if len(values) <= n:
        return values
    step = (len(values) - 1) / (n - 1)
    return [values[round(i * step)] for i in range(n)]


def build_route(r):
    lines = [l for l in r.get("geometry_wgs84") or [] if l]
    if not lines:
        return None
    start = [lines[0][0][1], lines[0][0][0]]  # lat, lon

    points = [p for p in r.get("points_on_route", []) if p.get("lat") is not None]
    # Drive to the parking spot nearest the start of the route, if there is one.
    parkings = [p for p in points if p["type"] == "P-plads"]
    parking = min(parkings, key=lambda p: haversine_m(start, (p["lat"], p["lon"])), default=None)

    stops = []
    for s in r.get("route_stops", []):
        if s["facilities"]:
            stops.append({"km": s["km_cumulative"], "types": sorted({f["type"] for f in s["facilities"]})})

    images = [i["url"] for i in r.get("images", []) if i.get("url")]
    header = r.get("header_image") or (images[0] if images else None) or r.get("image") or None
    elevation = [round(p["elevation"], 1) for p in r.get("elevation_profile", [])]

    return {
        "id": r["id"],
        "name": r["name"],
        "desc": r.get("description") or "",
        "km": round(r["mainRouteLength"] / 1000, 1) if r.get("mainRouteLength") else None,
        "kmTotal": round(r["totalRouteLength"] / 1000, 1) if r.get("totalRouteLength") else None,
        "slope": round(r["maxSlopePercentage"], 1) if r.get("maxSlopePercentage") is not None else None,
        "marked": r.get("marked_route"),
        "img": header,
        "images": images,
        "org": r.get("ansvar_Org"),
        "contact": r.get("contact") or {},
        "links": r.get("links", []),
        "videos": r.get("videos", []),
        "access": r.get("accessibility") or {},
        "ratings": r.get("ratings_text", []),
        "facilities": sorted({p["type"] for p in points if p.get("type")}),
        "stops": stops,
        "points": [[p["type"], p["name"], p["lat"], p["lon"]] for p in points],
        "start": start,
        "parking": [parking["lat"], parking["lon"], parking["name"]] if parking else None,
        "elev": sample(elevation, ELEVATION_SAMPLES),
        "geom": [encode_polyline(simplify(l, SIMPLIFY_TOLERANCE)) for l in lines],
        "gpx": r.get("gpx_url"),
        "url": r.get("url"),
    }


def main():
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else SRC
    records = json.loads(src.read_text(encoding="utf-8"))
    routes = [b for b in (build_route(r) for r in records) if b]
    DST.parent.mkdir(parents=True, exist_ok=True)
    DST.write_text(json.dumps(routes, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(routes)} routes -> {DST} ({DST.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()

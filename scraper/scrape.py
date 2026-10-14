"""Scrape vandreruter (hiking routes) from udinaturen.dk for one region.

Uses the site's internal map API for the route list, then fetches each
route's detail page for the extra metadata (facts, facilities along the
route, parking, images, links, contact, elevation profile, geometry).

Raw detail pages are cached in data/html/, so a rerun only fetches pages
that are missing (use --refresh to refetch everything).

Usage:
    .venv\\Scripts\\python scrape.py                 # Sjælland (region 85)
    .venv\\Scripts\\python scrape.py --limit 5       # quick test
    .venv\\Scripts\\python scrape.py --gpx           # also download GPX files
"""

import argparse
import csv
import json
import re
import sys
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup
from pyproj import Transformer

BASE = "https://udinaturen.dk"
REGIONS = {
    81: "nordjylland",
    82: "midtjylland",
    83: "syddanmark",
    84: "hovedstaden",
    85: "sjaelland",
}
VANDRERUTE_TYPE = 5  # FKG id for "Vandrerute"
USER_AGENT = "nature-routes-scraper/1.0 (personal use; contact: thomasgarp@outlook.com)"

ROOT = Path(__file__).parent
HTML_DIR = ROOT / "data" / "html"
GPX_DIR = ROOT / "data" / "gpx"
OUT_DIR = ROOT / "output"

# Data on the site is in ETRS89 / UTM zone 32N.
to_wgs84 = Transformer.from_crs("EPSG:25832", "EPSG:4326", always_xy=True)

session = requests.Session()
session.headers["User-Agent"] = USER_AGENT


def get(url, retries=4, **kwargs):
    for attempt in range(retries):
        try:
            r = session.get(url, timeout=60, **kwargs)
            if r.status_code < 500 and r.status_code != 429:
                r.raise_for_status()
                return r
            print(f"  HTTP {r.status_code} for {url}", file=sys.stderr)
        except requests.ConnectionError as e:
            print(f"  {e!r} for {url}", file=sys.stderr)
        time.sleep(5 * 2**attempt)
    raise RuntimeError(f"Giving up on {url}")


# --- route list -------------------------------------------------------------

def fetch_route_list(region):
    url = f"{BASE}/api/map/routes/GetRoutes"
    params = {"region": region, "type": VANDRERUTE_TYPE, "organisation": "", "kommunekoder": ""}
    routes = get(url, params=params).json()
    seen, unique = set(), []
    for r in routes:
        if r["id"] not in seen:
            seen.add(r["id"])
            unique.append(r)
    return unique


# --- detail page --------------------------------------------------------------

def detail_url(route_id):
    return f"{BASE}/rute/vandrerute/?routeid={route_id}"


def fetch_detail_html(route_id, refresh, delay):
    path = HTML_DIR / f"{route_id}.html"
    if path.exists() and not refresh:
        return path.read_text(encoding="utf-8"), False
    html = get(detail_url(route_id)).text
    path.write_text(html, encoding="utf-8")
    time.sleep(delay)
    return html, True


def js_var(html, name):
    """Return the JSON value of `var <name> = ...;` embedded in the page."""
    m = re.search(rf"var {name}\s*=\s*", html)
    if not m:
        return None
    value, _ = json.JSONDecoder().raw_decode(html, m.end())
    return value


def parse_elevation(html):
    m = re.search(r"const points\s*=\s*\[(.*?)\];", html, re.S)
    if not m:
        return []
    return [
        {"elevation": float(e), "slope": float(s)}
        for e, s in re.findall(r"elevation:\s*([-\d.eE]+),\s*slope:\s*([-\d.eE]+)", m.group(1))
    ]


def text(el):
    return el.get_text(" ", strip=True) if el else ""


def parse_km(s):
    m = re.search(r"([\d.,]+)\s*km", s or "")
    return float(m.group(1).replace(".", "").replace(",", ".")) if m else None


def id_from_href(href):
    m = re.search(r"[?&]id=([0-9a-f-]{36})", href or "")
    return m.group(1) if m else None


def project_line(line):
    return [[round(c, 6) for c in to_wgs84.transform(x, y)] for x, y in line]


def parse_detail(html):
    soup = BeautifulSoup(html, "html.parser")
    main = soup.find("main") or soup
    d = {}

    header = main.select_one(".ruteside > .header")
    m = re.search(r"url\('([^']*)'\)", header.get("style", "")) if header else None
    d["header_image"] = m.group(1) if m and m.group(1) else None

    d["name"] = text(main.select_one("#headline"))
    desc = main.select_one(".info .description")
    d["description"] = desc.get_text("\n", strip=True) if desc else ""

    facts = {}
    for prop in main.select(".facts .prop"):
        label = prop.find("b")
        key = text(label).rstrip(":")
        if label:
            label.extract()
        facts[key] = text(prop)
    d["facts"] = facts
    d["marked_route"] = {"Ja": True, "Nej": False}.get(facts.get("Afmærket rute"))

    d["images"] = []
    for img in main.select(".images_and_video .images-page img"):
        cap_id = img.get("aria-describedby")
        cap = main.find(id=cap_id) if cap_id else None
        d["images"].append({"url": img.get("src"), "alt": img.get("alt", ""), "caption": text(cap)})
    d["videos"] = [f.get("src") for f in main.select(".images_and_video iframe, .images_and_video video source")]
    d["videos"] += [a.get("href") for a in main.select(".images_and_video .video a[href]")]

    # "Oplysninger om tilgængelighed": question -> answer. The answer is either
    # in the right-hand column or in a nested div under the question.
    access = {}
    for row in main.select("#accessibility_info_container .list-row"):
        cols = row.find_all("div", recursive=False)
        if not cols:
            continue
        nested = cols[0].find("div")
        answer = text(cols[1]) if len(cols) > 1 else ""
        if nested:
            nested.extract()
            answer = answer or text(nested)
        access[text(cols[0])] = answer
    d["accessibility"] = access

    gpx = main.select_one("a[title='Download GPX fil']")
    d["gpx_url"] = gpx.get("href") if gpx else None

    # "Ruten i detaljer": facilities in order along the route.
    stops = []
    for row in main.select("#route_details_container .list-row"):
        cols = row.find_all("div", recursive=False)
        dists = row.select(".distance_ctn")
        cum = dists[-1] if dists else None
        prev = dists[0] if len(dists) == 2 else None
        links = cols[0].find_all("a") if cols else []
        stop = {
            "label": None if links else text(cols[0]),  # "Start" / "Mål"
            "facilities": [{"id": id_from_href(a.get("href")), "type": text(a)} for a in links],
            "km_from_previous": parse_km(text(prev)),
            "km_cumulative": parse_km(text(cum)),
        }
        stops.append(stop)
    d["route_stops"] = stops

    d["parking"] = []
    for p in main.select("#tabs_info_parking .parking_item"):
        divs = p.find_all("div", recursive=False)
        link = p.find("a")
        d["parking"].append({
            "id": id_from_href(link.get("href")) if link else None,
            "name": text(p.select_one(".headline")),
            "description": text(divs[1]) if len(divs) > 1 else "",
        })

    d["links"] = [
        {"text": text(a), "url": a.get("href")}
        for a in main.select("#links_container a[href]")
    ]

    ratings = main.select_one("#ratings_container .ratings")
    comments = [text(c) for c in ratings.select(".comment")] if ratings else []
    d["ratings_text"] = [c for c in comments if c != "Ingen vurderinger endnu"]

    resp = main.select_one("#responsible_container")
    contact = {"organisation": None, "email": None, "phone": None}
    if resp:
        org = resp.select_one(".mb-4")
        contact["organisation"] = text(org) or None
        mail = resp.select_one("a[href^='mailto:']")
        tel = resp.select_one("a[href^='tel:']")
        contact["email"] = mail.get("href")[7:] if mail else None
        contact["phone"] = tel.get("href")[4:] if tel else None
    d["contact"] = contact

    # Any section we don't know about yet, so new content isn't silently lost.
    known = {"Kort over ruten", "Ruten i detaljer", "Sådan kommer du dertil", "Vejrudsigt",
             "Links", "Brugernes vurdering", "Billeder fra ruten", "Video fra ruten",
             "Oplysninger om tilgængelighed"}
    d["other_sections"] = {}
    for h2 in main.find_all("h2"):
        title = text(h2)
        if title not in known:
            block = h2.find_parent(class_=re.compile(r"block-(odd|even)")) or h2.parent
            d["other_sections"][title] = block.get_text("\n", strip=True)

    # Embedded JS data: geometry, points along the route, elevation profile.
    geometry = js_var(html, "routeGeometry") or []
    d["geometry_wgs84"] = [project_line(line) for line in geometry]

    points = {}
    for p in js_var(html, "routePoints") or []:
        geom = p.get("Geometry") or []
        lon, lat = to_wgs84.transform(*geom[0]) if geom else (None, None)
        points[p["id"]] = {
            "id": p["id"],
            "name": p.get("name"),
            "type": p.get("type"),
            "type_id": p.get("typeId"),
            "image": p.get("image") or None,
            "lon": round(lon, 6) if lon is not None else None,
            "lat": round(lat, 6) if lat is not None else None,
        }
    d["points_on_route"] = list(points.values())
    d["elevation_profile"] = parse_elevation(html)
    return d


# --- output -------------------------------------------------------------------

API_FIELDS = [
    "id", "name", "type", "ansvar_Org", "cvrCode", "communeCode", "regions",
    "mainRouteLength", "totalRouteLength", "maxSlopePercentage", "roundTrip",
    "dkNatursti", "noStepStairs", "passageWidth", "pavementSolid", "pavementEven",
    "lowVisitsWeekdays", "lowVisitsWeekends", "fencedAnimals", "temakode",
    "off_kode", "userRating", "image", "description",
]


def build_record(api, detail):
    rec = {k: api.get(k) for k in API_FIELDS}
    rec["url"] = detail_url(api["id"])
    center = api.get("centerPoint") or []
    if len(center) >= 2:
        lon, lat = to_wgs84.transform(center[0], center[1])
        rec["center_lon"], rec["center_lat"] = round(lon, 6), round(lat, 6)
    else:
        rec["center_lon"] = rec["center_lat"] = None
    if detail:
        api_desc = rec.pop("description")
        rec.update({k: v for k, v in detail.items() if k != "name"})
        rec["description"] = detail["description"] or api_desc
        elev = [p["elevation"] for p in detail["elevation_profile"]]
        rec["elevation_min_m"] = round(min(elev), 1) if elev else None
        rec["elevation_max_m"] = round(max(elev), 1) if elev else None
    return rec


def write_outputs(records, slug):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    base = OUT_DIR / f"vandreruter_{slug}"

    with open(f"{base}.json", "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=1)

    features = []
    for r in records:
        props = {k: v for k, v in r.items() if k not in ("geometry_wgs84", "elevation_profile")}
        lines = r.get("geometry_wgs84") or []
        geom = None
        if len(lines) == 1:
            geom = {"type": "LineString", "coordinates": lines[0]}
        elif lines:
            geom = {"type": "MultiLineString", "coordinates": lines}
        features.append({"type": "Feature", "id": r["id"], "geometry": geom, "properties": props})
    with open(f"{base}.geojson", "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f, ensure_ascii=False)

    # Flat CSV, one row per route (utf-8-sig so Excel shows æøå correctly).
    flat_rows, fact_keys = [], []
    for r in records:
        row = {k: v for k, v in r.items() if not isinstance(v, (list, dict))}
        row["regions"] = ",".join(map(str, r.get("regions") or []))
        for prefix, field in (("fact", "facts"), ("tilgængelighed", "accessibility")):
            for k, v in (r.get(field) or {}).items():
                row[f"{prefix}: {k}"] = v
                if f"{prefix}: {k}" not in fact_keys:
                    fact_keys.append(f"{prefix}: {k}")
        row["videos"] = " ".join(r.get("videos") or [])
        contact = r.get("contact") or {}
        row["contact_organisation"] = contact.get("organisation")
        row["contact_email"] = contact.get("email")
        row["contact_phone"] = contact.get("phone")
        row["facility_types"] = "; ".join(sorted({p["type"] for p in r.get("points_on_route", []) if p["type"]}))
        row["n_facilities"] = len(r.get("points_on_route", []))
        row["parking"] = "; ".join(p["name"] for p in r.get("parking", []))
        row["images"] = " ".join(i["url"] for i in r.get("images", []))
        row["links"] = " ".join(l["url"] for l in r.get("links", []))
        flat_rows.append(row)
    fields = []
    for row in flat_rows:
        fields += [k for k in row if k not in fields and k not in fact_keys]
    fields += fact_keys
    with open(f"{base}.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(flat_rows)

    # One row per facility stop along each route.
    with open(f"{base}_faciliteter.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["route_id", "route_name", "stop_no", "label", "km_from_previous", "km_cumulative",
                    "facility_id", "facility_type", "facility_name", "lon", "lat"])
        for r in records:
            points = {p["id"]: p for p in r.get("points_on_route", [])}
            for i, stop in enumerate(r.get("route_stops", [])):
                common = [r["id"], r["name"], i, stop["label"], stop["km_from_previous"], stop["km_cumulative"]]
                if not stop["facilities"]:
                    w.writerow(common + [None] * 5)
                for fac in stop["facilities"]:
                    p = points.get(fac["id"], {})
                    w.writerow(common + [fac["id"], fac["type"], p.get("name"), p.get("lon"), p.get("lat")])

    print(f"Wrote {base}.json / .geojson / .csv / _faciliteter.csv")


def download_gpx(records, delay):
    GPX_DIR.mkdir(parents=True, exist_ok=True)
    for r in records:
        path = GPX_DIR / f"{r['id']}.gpx"
        if path.exists() or not r.get("gpx_url"):
            continue
        try:
            path.write_bytes(get(r["gpx_url"]).content)
        except Exception as e:
            print(f"  GPX failed for {r['id']}: {e}", file=sys.stderr)
        time.sleep(delay)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--region", type=int, default=85, choices=REGIONS, help="81-85, default 85 (Sjælland)")
    ap.add_argument("--delay", type=float, default=1.0, help="seconds between page requests")
    ap.add_argument("--limit", type=int, help="only process the first N routes")
    ap.add_argument("--refresh", action="store_true", help="refetch cached detail pages")
    ap.add_argument("--gpx", action="store_true", help="also download each route's GPX file")
    args = ap.parse_args()

    HTML_DIR.mkdir(parents=True, exist_ok=True)
    routes = fetch_route_list(args.region)
    print(f"{len(routes)} vandreruter in region {args.region} ({REGIONS[args.region]})")
    if args.limit:
        routes = routes[: args.limit]

    records, failures = [], []
    for i, api in enumerate(routes, 1):
        try:
            html, fetched = fetch_detail_html(api["id"], args.refresh, args.delay)
            detail = parse_detail(html)
        except Exception as e:
            print(f"  [{i}] {api['id']} failed: {e}", file=sys.stderr)
            failures.append(api["id"])
            detail = None
        records.append(build_record(api, detail))
        if fetched or i % 50 == 0 or i == len(routes):
            print(f"[{i}/{len(routes)}] {api['name']}", flush=True)

    write_outputs(records, REGIONS[args.region])
    if args.gpx:
        download_gpx(records, args.delay)
    if failures:
        print(f"{len(failures)} routes failed (API data only): {', '.join(failures)}", file=sys.stderr)


if __name__ == "__main__":
    main()

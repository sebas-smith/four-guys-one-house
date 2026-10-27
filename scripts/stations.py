"""Add the nearest station and walking time to each home.

Usage: python scripts/stations.py [--all] [--file listings.json]

Looks up each home's street on OpenStreetMap (Nominatim, at most one request a second, cached in
data/geo.json) and measures the straight-line distance to every station in data/stations.json.
Walking time assumes 80 m a minute and streets 30% longer than a straight line. Only homes
without a station are done unless --all is given.
"""
import datetime as dt
import json
import math
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from ingest_alerts import street as street_of  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
LISTINGS = ROOT / "data" / "listings.json"
STATIONS = ROOT / "data" / "stations.json"
GEO = ROOT / "data" / "geo.json"
VIEWBOX = "-0.32,51.52,-0.08,51.37"  # SW and W London to Shepherd's Bush: west, north, east, south
UA = "four-guys-one-house/1.0 (github.com/sebas-smith/four-guys-one-house)"
RETRY_DAYS = 7  # a street Nominatim couldn't find is looked up again after this many days


def nominatim(q):
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": q, "format": "json", "limit": 5, "countrycodes": "gb", "viewbox": VIEWBOX, "bounded": 1})
    time.sleep(1.1)
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=20) as r:
        return [[float(x["lat"]), float(x["lon"])] for x in json.load(r)]


def metres(a, b):
    dlat, dlon = math.radians(b[0] - a[0]), math.radians(b[1] - a[1])
    h = math.sin(dlat / 2) ** 2 + math.cos(math.radians(a[0])) * math.cos(math.radians(b[0])) * math.sin(dlon / 2) ** 2
    return 6371000 * 2 * math.asin(math.sqrt(h))


def stale(value):
    """True when a cache entry needs looking up: missing, or a miss (its date) older than RETRY_DAYS."""
    if isinstance(value, list):
        return False
    return not value or value < (dt.date.today() - dt.timedelta(days=RETRY_DAYS)).isoformat()


def locate(home, geo):
    """(lat, lon) of the home's street, closest to its area's centre when the name is ambiguous.

    Misses are cached as the date they were tried, so they're retried a week later rather than never.
    """
    street, area = street_of(home.get("title")), (home.get("area") or "").split("/")[0].strip()
    if not street:
        return None
    pc = re.search(r"\b(SW|SE|NW|KT|SM|CR|W)\d{1,2}\b", home.get("title") or "")
    key = f"{street}|{area}".lower()
    today = dt.date.today().isoformat()
    if stale(geo.get(key)):
        centre_key = f"|{area}".lower()
        if area and stale(geo.get(centre_key)):
            hits = nominatim(f"{area}, London")
            geo[centre_key] = hits[0] if hits else today
        hits = nominatim(f"{street}, {pc.group(0) if pc else area}, London") or nominatim(f"{street}, London")
        centre = geo.get(centre_key) if isinstance(geo.get(centre_key), list) else None
        geo[key] = min(hits, key=lambda p: metres(p, centre)) if hits and centre else (hits[0] if hits else today)
    return geo[key] if isinstance(geo[key], list) else None


def main(redo, path=LISTINGS):
    listings = json.load(open(path, encoding="utf-8"))
    stations = json.load(open(STATIONS, encoding="utf-8"))
    geo = json.load(open(GEO, encoding="utf-8")) if GEO.exists() else {}
    geo = {k: v for k, v in geo.items() if v is not None}  # old misses were cached forever as null
    done = 0
    try:
        for home in listings:
            if home.get("station") and not redo:
                continue
            where = locate(home, geo)
            if not where:
                continue
            s = min(stations, key=lambda s: metres(where, (s["lat"], s["lon"])))
            walk = round(metres(where, (s["lat"], s["lon"])) * 1.3 / 80)
            home["station"] = {"name": s["name"], "kind": s["kind"], "walk": max(walk, 1)}
            done += 1
    finally:
        json.dump(geo, open(GEO, "w", encoding="utf-8"), indent=0, sort_keys=True)
        json.dump(listings, open(path, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(f"stations added to {done} homes; {sum(1 for h in listings if not h.get('station'))} without one")


if __name__ == "__main__":
    args = sys.argv[1:]
    main("--all" in args, Path(args[args.index("--file") + 1]) if "--file" in args else LISTINGS)

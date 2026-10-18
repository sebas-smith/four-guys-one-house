"""Add the nearest station and walking time to each home.

Usage: python scripts/stations.py [--all]

Looks up each home's street on OpenStreetMap (Nominatim, at most one request a second, cached in
data/geo.json) and measures the straight-line distance to every station in data/stations.json.
Walking time assumes 80 m a minute and streets 30% longer than a straight line. Only homes
without a station are done unless --all is given.
"""
import json
import math
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LISTINGS = ROOT / "data" / "listings.json"
STATIONS = ROOT / "data" / "stations.json"
GEO = ROOT / "data" / "geo.json"
VIEWBOX = "-0.32,51.50,-0.08,51.37"  # SW London: west, north, east, south
UA = "four-guys-one-house/1.0 (github.com/sebas-smith/four-guys-one-house)"
STREET = re.compile(r"\b(road|street|avenue|lane|gardens|close|way|grove|place|mews|row|crescent|hill|drive|terrace|square|walk|court|park|rise|vale|green|parade|yard|wharf|house|common)\b", re.I)


def nominatim(q):
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": q, "format": "json", "limit": 5, "countrycodes": "gb", "viewbox": VIEWBOX, "bounded": 1})
    time.sleep(1.1)
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=20) as r:
        return [(float(x["lat"]), float(x["lon"])) for x in json.load(r)]


def metres(a, b):
    dlat, dlon = math.radians(b[0] - a[0]), math.radians(b[1] - a[1])
    h = math.sin(dlat / 2) ** 2 + math.cos(math.radians(a[0])) * math.cos(math.radians(b[0])) * math.sin(dlon / 2) ** 2
    return 6371000 * 2 * math.asin(math.sqrt(h))


def street_of(title):
    first = re.split(r",|\.\s+(?=[A-Z]{1,2}\d)|\s+[-–—]\s+", title or "")[0].strip()
    m = STREET.search(first)
    if m:  # 'Bucharest Road Battersea' -> 'Bucharest Road'; drop a leading house number
        return re.sub(r"^\d+\s+", "", first[:m.end()])
    return first if re.search(r"\w(way|heath|view|side)\b", first, re.I) else ""


def locate(home, geo):
    """(lat, lon) of the home's street, closest to its area's centre when the name is ambiguous."""
    street, area = street_of(home.get("title")), (home.get("area") or "").split("/")[0].strip()
    if not street:
        return None
    pc = re.search(r"\b(SW|SE|KT|SM|CR)\d{1,2}\b", home.get("title") or "")
    key = f"{street}|{area}".lower()
    if key not in geo:
        centre_key = f"|{area}".lower()
        if area and centre_key not in geo:
            hits = nominatim(f"{area}, London")
            geo[centre_key] = hits[0] if hits else None
        hits = nominatim(f"{street}, {pc.group(0) if pc else area}, London") or nominatim(f"{street}, London")
        centre = geo.get(centre_key)
        geo[key] = min(hits, key=lambda p: metres(p, centre)) if hits and centre else (hits[0] if hits else None)
    return geo[key]


def main(redo):
    listings = json.load(open(LISTINGS, encoding="utf-8"))
    stations = json.load(open(STATIONS, encoding="utf-8"))
    geo = json.load(open(GEO, encoding="utf-8")) if GEO.exists() else {}
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
        json.dump(listings, open(LISTINGS, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(f"stations added to {done} homes; {sum(1 for h in listings if not h.get('station'))} without one")


if __name__ == "__main__":
    main("--all" in sys.argv)

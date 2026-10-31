"""Draw the Tube, Overground, Elizabeth line, tram and train lines for the map: writes data/lines.json.

Usage: python scripts/rail_lines.py

Asks OpenStreetMap (Overpass) for every subway, train, light-rail and tram route crossing the search
area's box and keeps the track each one runs on, simplified to a few metres. Run it again only when
a line opens or the area grows; the lines barely change.
Output: {"lines": [{"name", "kind", "colour", "paths": [[[lat, lon], ...], ...]}]}; train companies share
track, so they're one grey "National Rail" line with an "operators" list.
"""
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "lines.json"
BOX = "51.36,-0.34,51.54,-0.06"  # south, west, north, east: a little beyond the drawn area
SERVERS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter",
           "https://overpass.private.coffee/api/interpreter"]
UA = "four-guys-one-house/1.0 (github.com/sebas-smith/four-guys-one-house)"
QUERY = f"""[out:json][timeout:180];
rel["route"~"^(subway|train|light_rail|tram)$"]({BOX})->.r;
.r out body;
way(r.r)({BOX});
out geom;"""

# TfL's own colours; anything else is national rail and drawn grey
TFL = {
    "bakerloo": ("Bakerloo", "#B36305"), "central": ("Central", "#E32017"), "circle": ("Circle", "#FFD300"),
    "district": ("District", "#00782A"), "hammersmith": ("Hammersmith & City", "#F3A9BB"),
    "jubilee": ("Jubilee", "#A0A5A9"), "metropolitan": ("Metropolitan", "#9B0056"), "northern": ("Northern", "#000000"),
    "piccadilly": ("Piccadilly", "#003688"), "victoria": ("Victoria", "#0098D4"), "waterloo": ("Waterloo & City", "#95CDBA"),
    "elizabeth": ("Elizabeth line", "#6950A1"), "mildmay": ("Mildmay (Overground)", "#437EC1"),
    "windrush": ("Windrush (Overground)", "#EF4D5E"), "lioness": ("Lioness (Overground)", "#FAA61A"),
    "suffragette": ("Suffragette (Overground)", "#5BB972"), "weaver": ("Weaver (Overground)", "#893B67"),
    "liberty": ("Liberty (Overground)", "#676767"), "dlr": ("DLR", "#00AFAD"), "tram": ("Tram", "#5FB526"),
}


def fetch():
    body = urllib.parse.urlencode({"data": QUERY}).encode()
    for attempt in range(6):
        url = SERVERS[attempt % len(SERVERS)]
        try:
            req = urllib.request.Request(url, data=body, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=240) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001 - busy servers answer 429/502/504
            print(f"{url}: {e}; retrying")
            time.sleep(10 * 2 ** attempt)
    raise SystemExit("Overpass didn't answer; try again later")


def line_of(tags):
    """(name, kind, colour) for a route relation."""
    text = " ".join(tags.get(k, "") for k in ("name", "ref", "network", "operator", "colour")).lower()
    route = tags["route"]
    if "mail rail" in text or "postal museum" in text:
        return None
    # Train routes only count as TfL when they're the Elizabeth line or Overground: "London Victoria"
    # and "London Waterloo" in a Southern or South Western route name aren't the Tube lines
    tfl = route != "train" or re.search(r"elizabeth|overground|transport for london", text)
    for key, (name, colour) in TFL.items() if tfl else []:
        if route == "train" and key not in ("elizabeth", "mildmay", "windrush", "lioness", "suffragette", "weaver", "liberty"):
            continue
        if re.search(rf"\b{key}\b", text):
            kind = "Tube" if route == "subway" else "Overground" if "overground" in name.lower() else \
                "Elizabeth" if key == "elizabeth" else "DLR" if key == "dlr" else "Tram" if route == "tram" else "Tube"
            return name, kind, colour
    if route == "tram":
        return TFL["tram"][0], "Tram", TFL["tram"][1]
    if route == "subway":
        return tags.get("name", "Underground"), "Tube", tags.get("colour", "#333333")
    operator = tags.get("operator") or tags.get("network") or "National Rail"
    for alias, same in (("thameslink", "Thameslink"), ("south ?eastern", "Southeastern"), ("greater anglia", "Greater Anglia"),
                        ("east coast", "LNER"), ("london north eastern", "LNER"), ("south western", "South Western Railway")):
        if re.search(alias, operator, re.I):
            operator = same
    return operator, "Rail", "#7a7f87"


def simplify(points, tol=0.00004):
    """Douglas-Peucker in degrees (about 4 m), so the file stays small."""
    if len(points) < 3:
        return points
    (ay, ax), (by, bx) = points[0], points[-1]
    dy, dx = by - ay, bx - ax
    norm = (dy * dy + dx * dx) ** 0.5 or 1e-12
    far, idx = 0, 0
    for i, (py, px) in enumerate(points[1:-1], 1):
        d = abs(dx * (ay - py) - dy * (ax - px)) / norm
        if d > far:
            far, idx = d, i
    if far <= tol:
        return [points[0], points[-1]]
    return simplify(points[:idx + 1], tol)[:-1] + simplify(points[idx:], tol)


def main():
    data = fetch()["elements"]
    ways = {e["id"]: [[round(p["lat"], 5), round(p["lon"], 5)] for p in e["geometry"]] for e in data if e["type"] == "way" and e.get("geometry")}
    lines = {}
    for rel in (e for e in data if e["type"] == "relation"):
        found = line_of(rel["tags"])
        if not found:
            continue
        name, kind, colour = found
        line = lines.setdefault(name, {"name": name, "kind": kind, "colour": colour, "ways": set()})
        line["ways"].update(m["ref"] for m in rel["members"] if m["type"] == "way" and m["ref"] in ways)
    # Train companies share track and are all drawn grey: one "National Rail" line, each track once
    rail = [x for x in lines.values() if x["kind"] == "Rail"]
    lines = {k: v for k, v in lines.items() if v["kind"] != "Rail"}
    lines["National Rail"] = {"name": "National Rail", "kind": "Rail", "colour": "#7a7f87",
                              "ways": set().union(*(x["ways"] for x in rail)), "operators": sorted(x["name"] for x in rail)}
    out = []
    for line in sorted(lines.values(), key=lambda x: (x["kind"] == "Rail", x["name"])):
        if not line["ways"]:
            continue
        paths = [simplify(ways[w]) for w in sorted(line["ways"])]
        out.append({"name": line["name"], "kind": line["kind"], "colour": line["colour"], "paths": paths,
                    **({"operators": line["operators"]} if "operators" in line else {})})
        print(f"{line['kind']:10} {line['name'][:40]:40} {len(paths)} pieces")
    json.dump({"lines": out}, open(OUT, "w", encoding="utf-8"), separators=(",", ":"))
    print(f"{len(out)} lines, {OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()

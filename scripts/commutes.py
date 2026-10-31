"""Journey times from each live home to our workplaces (data/workplaces.json).

Usage: python scripts/commutes.py [--all] [--file listings.json]

Public transport times come from TfL's Journey Planner (door to door, arriving 09:00 on a Wednesday);
Wentworth is a drive, timed by the public OSRM router (no traffic, so rush hour takes longer). Saved
on each home as `commute`: {"lcp": 38, "tritax": 35, "q5": 31, "wentworth": 41} in minutes. Needs the
home's position (`loc`, from stations.py). Only live homes without times are done unless --all.
"""
import datetime as dt
import json
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LISTINGS = ROOT / "data" / "listings.json"
WORKPLACES = ROOT / "data" / "workplaces.json"
UA = "four-guys-one-house/1.0 (github.com/sebas-smith/four-guys-one-house)"
CLOSED = {"gone", "no"}


def get(url):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=40) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001 - rate limits and busy servers: wait and retry
            if getattr(e, "code", None) in (400, 404):  # TfL: no journey found
                return {}
            time.sleep(5 * 2 ** attempt)
    return {}


def wednesday():
    """Next Wednesday, so the planner uses a normal weekday timetable."""
    today = dt.date.today()
    return (today + dt.timedelta(days=(2 - today.weekday()) % 7 or 7)).strftime("%Y%m%d")


def transit(a, b, day):
    d = get(f"https://api.tfl.gov.uk/Journey/JourneyResults/{a[0]},{a[1]}/to/{b[0]},{b[1]}?date={day}&time=0900&timeIs=Arriving")
    times = [j["duration"] for j in d.get("journeys", [])]
    time.sleep(1.3)  # TfL allows about 50 requests a minute without a key
    return min(times) if times else None


def drive(a, b):
    d = get(f"https://router.project-osrm.org/route/v1/driving/{a[1]},{a[0]};{b[1]},{b[0]}?overview=false")
    time.sleep(1.1)
    return round(d["routes"][0]["duration"] / 60) if d.get("routes") else None


def main(redo, path=LISTINGS):
    listings = json.load(open(path, encoding="utf-8"))
    places = json.load(open(WORKPLACES, encoding="utf-8"))
    day, done = wednesday(), 0
    try:
        for home in listings:
            if home.get("status") in CLOSED or not home.get("loc"):
                continue
            have = home.get("commute") or {}
            todo = [p for p in places if redo or have.get(p["id"]) is None]
            if not todo:
                continue
            for p in todo:
                b = (p["lat"], p["lon"])
                minutes = drive(home["loc"], b) if p["mode"] == "drive" else transit(home["loc"], b, day)
                if minutes is not None:
                    have[p["id"]] = minutes
            if have:
                home["commute"] = have
                done += 1
                if done % 20 == 0:
                    print(f"... {done} homes")
                    json.dump(listings, open(path, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    finally:
        json.dump(listings, open(path, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(f"commute times added to {done} homes")


if __name__ == "__main__":
    args = sys.argv[1:]
    main("--all" in args, Path(args[args.index("--file") + 1]) if "--file" in args else LISTINGS)

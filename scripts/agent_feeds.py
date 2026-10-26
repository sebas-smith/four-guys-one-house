"""Add new homes straight from agents' own listings, for agents that keep some homes off the portals.

Usage: python scripts/agent_feeds.py [--dry-run]

Marsh & Parsons: its search page carries every listing's data (rent, beds, status, map point), so we
read its London 4-bed lettings and keep homes inside the drawn area (search_area.py) at our rents.
A home already on the list (same advert, or same_home on another site) gets the link added instead.
"""
import datetime
import json
import re
import sys

from curl_cffi import requests

from ingest_alerts import EXCLUDED_AREAS, LISTINGS, MAX_RENT, MIN_BEDS, MIN_RENT, area_from, merge_price, record_price, same_home
from search_area import inside

MP_SEARCH = "https://www.marshandparsons.co.uk/properties-to-rent/london/4-bedroom/?minPrice={}&maxPrice={}&page={}"
MP_ADVERT = "https://www.marshandparsons.co.uk/properties-to-rent/london/property/{}/{}/"


def weekly(pcm):
    return round(pcm * 12 / 52)


def marsh_and_parsons():
    """Live M&P lettings in the area as (id, url, title, rent pcm, beds, baths)."""
    homes, page = [], 1
    while page <= 10:
        html = requests.get(MP_SEARCH.format(weekly(MIN_RENT) - 10, weekly(MAX_RENT) + 10, page), impersonate="chrome", timeout=40).text
        start = html.find("properties: {")
        if start < 0:
            raise RuntimeError("Marsh & Parsons search page has changed: no 'properties:' data")
        blob, _ = json.JSONDecoder().raw_decode(html, start + len("properties: "))
        for p in blob.get("data", []):
            rps = p.get("rawRPSData", {})
            lng, lat = (p.get("geoJSONPoint") or {}).get("coordinates", (0, 0))
            if rps.get("InternalLettingStatus") != "To Let" or p.get("redTag") or not rps.get("MarketedOnInternet"):
                continue
            if not inside(lat, lng):
                continue
            pid = (p.get("RPSID") or "").replace("rps_mpa-", "")
            rent = round(p["WeeklyRent"] * 52 / 12) if p.get("WeeklyRent") else None
            title = f"{p.get('publicTitle', '').strip()}, {p.get('firstPostcodePart', '')}".strip(", ")
            homes.append((pid, MP_ADVERT.format(pid, p.get("slug", "")), title, rent, int(p.get("Bedrooms") or 0) or None, int(rps.get("Bathrooms") or 0) or None))
        if not blob.get("next_page_url"):
            break
        page += 1
    return homes


def main():
    dry = "--dry-run" in sys.argv
    listings = json.load(open(LISTINGS, encoding="utf-8"))
    today = datetime.date.today().isoformat()
    known = " ".join(u for r in listings for u in r.get("links", []) + [r.get("url") or ""])
    added = []
    for pid, url, title, rent, beds, baths in marsh_and_parsons():
        if f"/property/{pid}/" in known:
            continue
        if not rent or not MIN_RENT <= rent <= MAX_RENT or (beds or 0) < MIN_BEDS or EXCLUDED_AREAS.search(title):
            continue
        dup = same_home(listings, title, rent, beds, baths, [url])
        if dup:
            dup.setdefault("links", []).append(url)
            merge_price(dup, rent, f"Marsh & Parsons {today}", today, "marshandparsons")
            added.append(f"{url} linked to existing {dup['id']}")
            continue
        listings.append({
            "id": f"marshandparsons-{pid}", "title": title, "area": area_from(title), "rent": rent, "beds": beds,
            "baths": baths, "available": "", "sharers": "unknown", "status": "new", "url": url, "links": [url],
            "source": "agent", "added": today, "notes": [f"From the Marsh & Parsons website on {today}."],
        })
        record_price(listings[-1], rent, today, "marshandparsons")
        added.append(f"marshandparsons-{pid} {title} £{rent}")
    if not dry:
        json.dump(listings, open(LISTINGS, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(f"added {len(added)} from agent sites")
    for a in added:
        print("  +", a)


if __name__ == "__main__":
    main()

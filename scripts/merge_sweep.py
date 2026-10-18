"""Merge a ChatGPT sweep CSV into data/listings.json.

Usage: python scripts/merge_sweep.py path/to/housing-sweep.csv [--dry-run]

Matches homes by id or by any shared portal listing link. Updates rent, availability,
links and status from the sweep. Never overrides a status a person set (shortlist,
viewing, applied, no), except to record in a note that the advert has gone.
"""
import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LISTINGS = ROOT / "data" / "listings.json"
PERSON_SET = {"shortlist", "viewing", "applied", "no"}
REQUIRED = {"id", "address_or_area", "area", "monthly_rent_gbp", "bedrooms", "bathrooms", "availability",
            "status", "first_seen", "sharer_suitability", "listing_urls", "checked_at"}
EXCLUDED_AREAS = re.compile(r"isleworth|osterley|new malden|hounslow|twickenham|whitton", re.I)
LINK_KEYS = [
    re.compile(r"rightmove\.co\.uk/properties/(\d+)"),
    re.compile(r"zoopla\.co\.uk/to-rent/details/(\d+)"),
    re.compile(r"onthemarket\.com/details/(\d+)"),
    re.compile(r"openrent\.co\.uk/.*?(\d{6,7})(?:\D|$)"),
    re.compile(r"(?:foxtons|jacksonsestateagents|dexters|kfh|hamptons|cound|grovesresidential)\.co[^\s|]*?([a-z]*\d{4,})", re.I),
]


def keys(urls):
    out = set()
    for u in urls:
        for i, rx in enumerate(LINK_KEYS):
            m = rx.search(u)
            if m:
                out.add((i, m.group(1).lower()))
    return out


def num(s):
    try:
        return round(float(s)) if s and s.strip() else None
    except ValueError:
        return None


def sweep_status(s):
    s = s.lower()
    if s.startswith(("let agreed", "removed")):
        return "gone"
    if "outside current rent band" in s or "bedroom count below" in s:
        return "no"
    return "new"  # live, or unverified: still worth reviewing


def clean_links(raw):
    links = []
    for u in raw.split("|"):
        u = u.strip().split("#")[0]
        if u and not re.search(r"\.(jpg|png|pdf)$", u) and u not in links:
            links.append(u)
    return links


def main(src, dry):
    listings = json.load(open(LISTINGS, encoding="utf-8"))
    by_id = {r["id"]: r for r in listings}
    by_key = {}
    for r in listings:
        for k in keys(r.get("links", []) + [r.get("url", "")]):
            by_key.setdefault(k, r)

    rows = list(csv.DictReader(open(src, encoding="utf-8-sig")))
    missing = REQUIRED - set(rows[0] if rows else [])
    if missing:
        sys.exit(f"{src} is missing columns: {', '.join(sorted(missing))}")
    added = updated = gone = 0
    for row in rows:
        lid = re.sub(r"[^A-Za-z0-9_.-]", "-", row["id"]).lower()
        links = clean_links(row["listing_urls"])
        checked = (row.get("checked_at") or row.get("last_verified") or "")[:10]
        status = sweep_status(row["status"])
        if EXCLUDED_AREAS.search(f"{row['area']} {row['address_or_area']}"):
            status = "no" if status != "gone" else status
        rent = num(row["monthly_rent_gbp"])
        avail = row["availability"].strip()
        avail = "" if avail.lower() in ("not stated", "unavailable", "ask agent") else avail[:40]

        match = by_id.get(lid) or next((by_key[k] for k in keys(links) if k in by_key), None)
        if match:
            notes = match.setdefault("notes", [])

            def note(text):
                if text not in notes:
                    notes.append(text)

            if rent and match.get("rent") and rent != match["rent"]:
                note(f"Price changed from £{match['rent']:,} to £{rent:,} ({checked}).")
            if rent:
                match["rent"] = rent
            if avail:
                match["available"] = avail
            for u in links:
                if u not in match["links"]:
                    match["links"].append(u)
            if row["sharer_suitability"] == "advertised":
                match["sharers"] = "ok"
            elif row["sharer_suitability"] == "excluded":
                match["sharers"] = "no"
            if status == "gone" and match["status"] != "gone":
                if match["status"] in PERSON_SET:
                    note(f"Advert shows {row['status']} ({checked}).")
                else:
                    match["status"] = "gone"
                    note(f"Marked gone: advert shows {row['status']} ({checked}).")
                gone += 1
            elif match["status"] not in PERSON_SET and match["status"] != status:
                match["status"] = status
            match["checked"] = checked
            updated += 1
        else:
            if status == "gone":
                continue  # never seen live by us; no point adding a dead advert
            url = next((u for k in ("rightmove", "zoopla", "onthemarket", "openrent") for u in links if k in u), links[0] if links else "")
            rec = {
                "id": lid, "title": row["address_or_area"].strip() or row["area"], "area": row["area"],
                "rent": rent, "beds": num(row["bedrooms"]), "baths": num(row["bathrooms"]), "available": avail,
                "sharers": {"advertised": "ok", "excluded": "no"}.get(row["sharer_suitability"], "unknown"),
                "status": "no" if row["sharer_suitability"] == "excluded" else status,
                "url": url, "links": links, "source": "sweep", "added": row["first_seen"] or checked,
                "checked": checked, "notes": [f"Found by ChatGPT sweep ({row['status']})."],
            }
            listings.append(rec)
            by_id[lid] = rec
            for k in keys(links):
                by_key.setdefault(k, rec)
            added += 1

    if not dry:
        json.dump(listings, open(LISTINGS, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(f"{len(rows)} sweep rows: {added} added, {updated} updated ({gone} newly gone). Total {len(listings)}.")


if __name__ == "__main__":
    main(sys.argv[1], "--dry-run" in sys.argv)

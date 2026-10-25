"""Merge a ChatGPT sweep CSV into data/listings.json.

Usage: python scripts/merge_sweep.py path/to/housing-sweep.csv [--dry-run]

Matches homes by id or by any shared portal listing link. Updates rent, availability,
links and status from the sweep. A row's links that belong to another home, or that are a second
advert on a portal the home is already on (and the row's rent, beds or baths differ), aren't added. Never overrides a status a person set (shortlist,
viewing, applied, no). When the sweep says let agreed or removed, the home is only flagged
(sweep_gone); check_live.py opens the adverts and decides.
"""
import csv
import json
import re
import sys
from pathlib import Path

from ingest_alerts import merge_price, record_price, same_home, site_name

ROOT = Path(__file__).resolve().parent.parent
LISTINGS = ROOT / "data" / "listings.json"
PERSON_SET = {"shortlist", "viewing", "applied", "no"}
PORTALS = {"rightmove", "zoopla", "onthemarket", "openrent"}
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
                break
        else:
            if u:  # any other agent site: the link itself, ignoring scheme, www, query and trailing slash
                out.add(("url", re.sub(r"^https?://(www\.)?|[?#].*$|/$", "", u.strip().lower())))
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


def portal_history(home, row, rent, site):
    """Optional sweep columns previous_rent_gbp / price_reduced_on: a cut the portal shows from before we saw it."""
    prev = num(row.get("previous_rent_gbp") or "")
    if prev and rent and prev != rent and not any(p[1] == prev for p in home.get("prices", [])):
        home.setdefault("prices", []).insert(0, ["", prev, site])
        when = (row.get("price_reduced_on") or "")[:10]
        if when and home["prices"][-1][1] == rent and not home["prices"][-1][0]:
            home["prices"][-1][0] = when


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
    added = updated = gone = skipped = 0
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

        url = next((u for k in ("rightmove", "zoopla", "onthemarket", "openrent") for u in links if k in u), links[0] if links else "")
        match = by_id.get(lid) or next((by_key[k] for k in keys(links) if k in by_key), None)
        if not match and status != "gone":
            match = same_home(listings, row["address_or_area"], rent, num(row["bedrooms"]), num(row["bathrooms"]), links, avail)
        if match:
            # Compared before the row updates the home: does the row describe this same home?
            fits = rent == match.get("rent") and num(row["bedrooms"]) == match.get("beds") and num(row["bathrooms"]) == match.get("baths")
            notes = match.setdefault("notes", [])

            def note(text):
                if text not in notes:
                    notes.append(text)

            if not keys(match["links"]) <= keys(links):
                # The row only saw some of this home's adverts; another portal may show a different price.
                merge_price(match, rent, f"sweep {checked}", checked, site_name(url))
            else:
                if rent and match.get("rent") and rent != match["rent"]:
                    note(f"Price changed from £{match['rent']:,} to £{rent:,} ({checked}).")
                if rent:
                    record_price(match, rent, checked, site_name(url))
                    match["rent"] = rent
            portal_history(match, row, rent, site_name(url))
            if avail:
                match["available"] = avail
            for u in links:
                if u in match["links"]:
                    continue
                # A sweep row sometimes bundles adverts for several flats on one street. Leave out
                # adverts another home already has, and extra adverts on a portal this home is
                # already on unless the row matches the home (then it's a relist).
                owner = next((by_key[k] for k in keys([u]) if k in by_key), match)
                portal = site_name(u) in PORTALS and site_name(u) in {site_name(v) for v in match["links"]}
                if owner is not match or (portal and not fits):
                    skipped += 1
                    continue
                match["links"].append(u)
                for k in keys([u]):
                    by_key.setdefault(k, match)
            if row["sharer_suitability"] == "advertised":
                match["sharers"] = "ok"
            elif row["sharer_suitability"] == "excluded":
                match["sharers"] = "no"
            if status == "gone" and match["status"] != "gone":
                # The sweep sometimes reads a different advert for the same street, so check_live.py
                # opens the adverts itself before anything is marked gone.
                note(f"ChatGPT sweep says {row['status']} ({checked}).")
                match["sweep_gone"] = checked
                gone += 1
            elif status != "gone" and match["status"] not in PERSON_SET and match["status"] != status and not match.get("off_market"):
                # check_live.py read the advert itself; trust that over the sweep saying live
                match["status"] = status
                match.pop("sweep_gone", None)
            match["checked"] = checked
            updated += 1
        else:
            if status == "gone":
                continue  # never seen live by us; no point adding a dead advert
            rec = {
                "id": lid, "title": row["address_or_area"].strip() or row["area"], "area": row["area"],
                "rent": rent, "beds": num(row["bedrooms"]), "baths": num(row["bathrooms"]), "available": avail,
                "sharers": {"advertised": "ok", "excluded": "no"}.get(row["sharer_suitability"], "unknown"),
                "status": "no" if row["sharer_suitability"] == "excluded" else status,
                "url": url, "links": links, "source": "sweep", "added": row["first_seen"] or checked,
                "checked": checked, "notes": [f"Found by ChatGPT sweep ({row['status']})."],
            }
            record_price(rec, rent, rec["added"], site_name(url))
            portal_history(rec, row, rent, site_name(url))
            listings.append(rec)
            by_id[lid] = rec
            for k in keys(links):
                by_key.setdefault(k, rec)
            added += 1

    if not dry:
        json.dump(listings, open(LISTINGS, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(f"{len(rows)} sweep rows: {added} added, {updated} updated ({gone} said to be gone, to check). Total {len(listings)}.")
    if skipped:
        print(f"{skipped} links left off homes: another home has them, or another advert on the same portal")


if __name__ == "__main__":
    main(sys.argv[1], "--dry-run" in sys.argv)

"""Merge a ChatGPT sweep CSV into data/listings.json.

Usage: python scripts/merge_sweep.py path/to/housing-sweep.csv [--dry-run] [--file listings.json]
       python scripts/merge_sweep.py --pending [--ids-out added.txt] [--dry-run] [--file listings.json]

Matches homes by id or by any shared portal listing link. Updates rent, availability,
links and status from the sweep, and fills a matched home's missing title, area, rent, beds or baths.
A row's links that belong to another home, or that are a second
advert on a portal the home is already on (and the row's rent, beds or baths differ), aren't added. Never overrides a status a person set (shortlist,
viewing, applied, no). When the sweep says let agreed or removed, the home is only flagged
(sweep_gone); check_live.py opens the adverts and decides.

--pending merges every sweeps/*.csv not merged yet, or rewritten since (data/merged_sweeps.json keeps
each file's hash), so a workflow run GitHub dropped catches up next time. The first run, with no
merged_sweeps.json, records the files already there without merging them. --ids-out appends the ids
of homes added.
"""
import csv
import datetime
import hashlib
import json
import re
import sys
from pathlib import Path

from ingest_alerts import merge_price, record_price, same_home, site_name

ROOT = Path(__file__).resolve().parent.parent
LISTINGS = ROOT / "data" / "listings.json"
SWEEPS = ROOT / "sweeps"
PLACEHOLDER = re.compile(r"^\s*$|^(rightmove|zoopla|onthemarket|openrent) listing \d+$|^unverified geography$", re.I)
PERSON_SET = {"shortlist", "viewing", "applied", "no"}
PORTALS = {"rightmove", "zoopla", "onthemarket", "openrent"}
REQUIRED = {"id", "address_or_area", "area", "monthly_rent_gbp", "bedrooms", "bathrooms", "availability",
            "status", "first_seen", "sharer_suitability", "listing_urls", "checked_at"}
EXCLUDED_AREAS = re.compile(r"isleworth|osterley|new malden|hounslow|twickenham|whitton|brixton|streatham|\b(TW\d{1,2}|KT3|SW2|SW16|SE\d{1,2}|W3|W1[01])\b", re.I)
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


def fill_blanks(home, row, rent):
    """Fill fields the home is missing (an alert email with no address, say) from the sweep row."""
    filled = 0
    title = row["address_or_area"].strip() or row["area"].strip()
    for f, value in (("title", title), ("area", row["area"].strip()), ("rent", rent),
                     ("beds", num(row["bedrooms"])), ("baths", num(row["bathrooms"]))):
        if value and not PLACEHOLDER.match(str(value)) and (home.get(f) is None or PLACEHOLDER.match(str(home[f]))):
            home[f] = value
            filled += 1
    return filled


def main(src, dry, path=LISTINGS, ids_out=None):
    listings = json.load(open(path, encoding="utf-8"))
    by_id = {r["id"]: r for r in listings}
    by_key = {}
    for r in listings:
        for k in keys(r.get("links", []) + [r.get("url", "")]):
            by_key.setdefault(k, r)

    reader = csv.DictReader(open(src, encoding="utf-8-sig"))
    rows = list(reader)
    missing = REQUIRED - set(reader.fieldnames or [])
    if missing:
        sys.exit(f"{src} is missing columns: {', '.join(sorted(missing))}")
    added = updated = gone = skipped = filled = 0
    new_ids = []
    for row in rows:
        lid = re.sub(r"[^A-Za-z0-9_.-]", "-", row["id"]).lower()
        links = clean_links(row["listing_urls"])
        checked = (row.get("checked_at") or row.get("last_verified") or "")[:10]
        status = sweep_status(row["status"])
        why_no = "sweep: rent band or beds" if status == "no" else None
        if EXCLUDED_AREAS.search(f"{row['area']} {row['address_or_area']}"):
            status, why_no = ("no", "excluded area") if status != "gone" else (status, None)
        if row["sharer_suitability"] == "excluded" and status != "gone":
            status, why_no = "no", "no sharers"
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
            filled += fill_blanks(match, row, rent)

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
            elif status != "gone" and match["status"] != status and (match["status"] not in PERSON_SET or match.get("ruled_out")) \
                    and not str(match.get("off_market", {}).get("why", "ChatGPT")).startswith(("Let agreed", "Advert taken down")):
                # check_live.py read the advert itself; trust that over the sweep saying live. A rule-out
                # the scripts made (ruled_out) or a gone the sweep alone decided can be undone.
                match["status"] = status
                match.pop("sweep_gone", None)
                if match.get("off_market", {}).get("why", "").startswith("ChatGPT"):
                    match.pop("off_market")
                if status == "no":
                    match["ruled_out"] = why_no
                else:
                    match.pop("ruled_out", None)
            match["checked"] = checked
            updated += 1
        else:
            if status == "gone":
                continue  # never seen live by us; no point adding a dead advert
            rec = {
                "id": lid, "title": row["address_or_area"].strip() or row["area"], "area": row["area"],
                "rent": rent, "beds": num(row["bedrooms"]), "baths": num(row["bathrooms"]), "available": avail,
                "sharers": {"advertised": "ok", "excluded": "no"}.get(row["sharer_suitability"], "unknown"),
                "status": status,
                "url": url, "links": links, "source": "sweep", "added": row["first_seen"] or checked,
                "added_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
                "checked": checked, "notes": [f"Found by ChatGPT sweep ({row['status']})."],
            }
            if why_no:
                rec["ruled_out"] = why_no
            record_price(rec, rent, rec["added"], site_name(url))
            portal_history(rec, row, rent, site_name(url))
            listings.append(rec)
            by_id[lid] = rec
            for k in keys(links):
                by_key.setdefault(k, rec)
            added += 1
            new_ids.append(lid)

    if not dry:
        json.dump(listings, open(path, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
        if ids_out and new_ids:
            with open(ids_out, "a", encoding="utf-8") as f:
                f.write("".join(i + "\n" for i in new_ids))
    print(f"{src}: {len(rows)} sweep rows: {added} added, {updated} updated ({gone} said to be gone, to check, "
          f"{filled} blank fields filled). Total {len(listings)}.")
    if skipped:
        print(f"{skipped} links left off homes: another home has them, or another advert on the same portal")


def digest(csv_path):
    return hashlib.sha256(Path(csv_path).read_bytes().replace(b"\r\n", b"\n")).hexdigest()[:16]


def pending(dry, path, ids_out):
    """Merge each sweep CSV that's new or changed since it was last merged, oldest first."""
    record_path = path.parent / "merged_sweeps.json"
    record = json.load(open(record_path, encoding="utf-8")) if record_path.exists() else None
    files = sorted(SWEEPS.glob("*.csv"))
    if record is None:
        record = {f.name: digest(f) for f in files}
        print(f"No {record_path.name} yet: recorded {len(record)} sweep files as merged already")
    else:
        todo = [f for f in files if record.get(f.name) != digest(f)]
        bad = []
        for f in todo:
            try:
                main(f, dry, path, ids_out)
            except SystemExit as e:  # a CSV missing columns; merge the rest, fail at the end
                print(e)
                bad.append(f.name)
                continue
            record[f.name] = digest(f)
            if not dry:  # saved after each file, as main() saves the listings after each
                json.dump(record, open(record_path, "w", encoding="utf-8"), indent=1)
        if not todo:
            print("No new sweep files")
        if bad:
            sys.exit(f"Not merged: {', '.join(bad)}")
    if not dry:
        json.dump(record, open(record_path, "w", encoding="utf-8"), indent=1)


if __name__ == "__main__":
    args = sys.argv[1:]
    listings_path = Path(args[args.index("--file") + 1]) if "--file" in args else LISTINGS
    out = args[args.index("--ids-out") + 1] if "--ids-out" in args else None
    if "--pending" in args:
        pending("--dry-run" in args, listings_path, out)
    else:
        main(args[0], "--dry-run" in args, listings_path, out)
        done = listings_path.parent / "merged_sweeps.json"
        if "--dry-run" not in args and done.exists() and Path(args[0]).resolve().parent == SWEEPS:
            record = json.load(open(done, encoding="utf-8"))
            record[Path(args[0]).name] = digest(args[0])
            json.dump(record, open(done, "w", encoding="utf-8"), indent=1)

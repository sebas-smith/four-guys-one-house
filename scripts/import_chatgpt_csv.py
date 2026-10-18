"""One-off import of the old ChatGPT housing export into data/listings.json.

Usage: python scripts/import_chatgpt_csv.py path/to/housing-export.csv
"""
import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def num(s):
    try:
        return round(float(s)) if s.strip() else None
    except ValueError:
        return None


def status(s):
    s = s.lower()
    if s in ("verified", "recheck"):
        return "new"
    if s == "unavailable" or "let agreed" in s or s == "screened; unavailable":
        return "gone"
    return "no"


def main(src):
    rows = list(csv.DictReader(open(src, encoding="utf-8-sig")))
    out, seen = [], set()
    for r in rows:
        lid = re.sub(r"[^A-Za-z0-9_.-]", "-", r["id"]).lower()
        assert lid not in seen, lid
        seen.add(lid)
        links = [u for u in r["listing_urls"].split("|") if u and not re.search(r"\.(jpg|png|pdf)$", u)]
        url = next((u for k in ("rightmove", "zoopla", "openrent") for u in links if k in u), links[0] if links else "")
        avail = r["availability"].strip()
        notes = [f"Imported from the old ChatGPT tracker (status: {r['status']})."]
        if r["last_verified"]:
            notes[0] += f" Last checked {r['last_verified'][:10]}."
        if r["sharer_suitability"] == "excluded":
            notes.append("Advert says not suitable for sharers.")
        if len(avail) > 40:
            notes.append("Availability: " + avail[:200])
            avail = avail[:37].rstrip() + "..."
        if avail.lower() in ("not stated", "unavailable"):
            avail = ""
        out.append({
            "id": lid,
            "title": r["address_or_area"].strip() or r["area"] or "Unnamed listing",
            "area": r["area"],
            "rent": num(r["monthly_rent_gbp"]),
            "beds": num(r["bedrooms"]),
            "baths": num(r["bathrooms"]),
            "available": avail,
            "sharers": {"advertised": "ok", "excluded": "no"}.get(r["sharer_suitability"], "unknown"),
            "status": status(r["status"]),
            "url": url,
            "links": links,
            "source": "import",
            "added": r["first_seen"] or "2026-09-24",
            "notes": notes,
        })
    path = ROOT / "data" / "listings.json"
    json.dump(out, open(path, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(f"wrote {len(out)} listings to {path}")


if __name__ == "__main__":
    main(sys.argv[1])

"""Merge homes listed twice (same street, beds and rent on different portals) into one.

Usage: python scripts/dedupe.py [--dry-run]

Keeps the first-added record, moves the other's links and notes onto it, and removes the other.
A status one of us set (shortlist, viewing, applied, no) wins over "new". Homes listed in each
other's `not_same` are never merged.
"""
import json
import sys
from pathlib import Path

from ingest_alerts import LISTINGS, merge_price, same_home, site_name

RANK = {"applied": 5, "viewing": 4, "shortlist": 3, "no": 2, "new": 1, "gone": 0}


def main(dry):
    listings = json.load(open(LISTINGS, encoding="utf-8"))
    kept, merged = [], 0
    for r in listings:
        # not_same: homes split apart by hand (split_merged.py) after being wrongly merged
        apart = [k for k in kept if k["id"] not in r.get("not_same", []) and r["id"] not in k.get("not_same", [])]
        m = same_home(apart, r.get("title"), r.get("rent"), r.get("beds"), r.get("baths"), r.get("links", []), r.get("available")) if r["status"] != "gone" else None
        if not m:
            kept.append(r)
            continue
        for p in r.get("prices", []):
            if p not in m.setdefault("prices", []):
                m["prices"].append(p)
        m.setdefault("prices", []).sort(key=lambda p: p[0])
        merge_price(m, r.get("rent"), "", r.get("checked") or r.get("added", ""), site_name(r.get("url")))
        for u in r.get("links", []):
            if u not in m["links"]:
                m["links"].append(u)
        m["notes"] = m.get("notes", []) + [n for n in r.get("notes", []) if n not in m.get("notes", [])]
        if RANK[r["status"]] > RANK[m["status"]]:
            m["status"] = r["status"]
        for f in ("baths", "available"):
            m[f] = m.get(f) or r.get(f)
        if r.get("sharers") != "unknown" and m.get("sharers") == "unknown":
            m["sharers"] = r["sharers"]
        if (r.get("checked") or "") > (m.get("checked") or ""):
            m["checked"] = r["checked"]
        merged += 1
    if not dry:
        json.dump(kept, open(LISTINGS, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(f"merged {merged} duplicates; {len(kept)} homes left")


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).parent))
    main("--dry-run" in sys.argv)

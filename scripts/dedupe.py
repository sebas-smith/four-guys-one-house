"""Merge homes listed twice (same street, beds and rent on different portals) into one.

Usage: python scripts/dedupe.py [--dry-run] [--file listings.json] [--notes-only]

First merges homes that share an advert link. If one of those was found let or taken down
(status gone, not set by one of us) and the other is still "new", the merged home stays gone.
Then merges homes ingest_alerts.same_home calls the same, and homes on an agent's own site
(Marsh & Parsons and the like) with the same street, beds and baths and rent within 8% of a home
on another site. Keeps the first-added record, moves the other's links and notes onto it, and
removes the other. A status one of us set (shortlist, viewing, applied, no) wins over "new".
Homes listed in each other's `not_same` are never merged. Also drops repeated notes.
--notes-only just drops repeated notes.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from ingest_alerts import LISTINGS, PORTAL_SITES, merge_price, same_home, site_name, sites, street  # noqa: E402
from merge_sweep import PLACEHOLDER, keys  # noqa: E402

RANK = {"applied": 5, "viewing": 4, "shortlist": 3, "no": 2, "new": 1, "gone": 0}


def apart(a, b):
    return a["id"] in b.get("not_same", []) or b["id"] in a.get("not_same", [])


def agent_twin(kept, r):
    """A home on another site with the same street, beds and baths and rent within 8%, one side an agent's own site."""
    s, hosts = street(r.get("title")), sites(r.get("links", []))
    if not (s and r.get("rent") and r.get("beds") and r["status"] != "gone"):
        return None
    for k in kept:
        theirs = sites(k.get("links", []))
        if (k["status"] == "gone" or not k.get("rent") or k.get("beds") != r["beds"] or street(k.get("title")) != s
                or hosts & theirs or not (hosts | theirs) - PORTAL_SITES):
            continue
        if r.get("baths") and k.get("baths") and r["baths"] != k["baths"]:
            continue
        if abs(k["rent"] - r["rent"]) <= 0.08 * max(k["rent"], r["rent"]):
            return k
    return None


def absorb(m, r, shared):
    """Move r's links, prices, notes and anything m is missing onto m."""
    for p in r.get("prices", []):
        if p not in m.setdefault("prices", []):
            m["prices"].append(p)
    m.setdefault("prices", []).sort(key=lambda p: p[0])
    merge_price(m, r.get("rent"), "", r.get("checked") or r.get("added", ""), site_name(r.get("url")))
    for u in r.get("links", []):
        if u not in m["links"]:
            m["links"].append(u)
    m["notes"] = m.get("notes", []) + [n for n in r.get("notes", []) if n not in m.get("notes", [])]
    if shared and "gone" in (m["status"], r["status"]) and "new" in (m["status"], r["status"]):
        # the same advert, and one of them was found let or taken down
        gone = m if m["status"] == "gone" else r
        m["status"] = "gone"
        if gone.get("off_market"):
            m["off_market"] = gone["off_market"]
    elif RANK[r["status"]] > RANK[m["status"]]:
        m["status"] = r["status"]
    for f in ("baths", "available", "beds", "area", "url", "station"):
        if m.get(f) or r.get(f):
            m[f] = m.get(f) or r.get(f)
    if PLACEHOLDER.match(m.get("title") or "") and not PLACEHOLDER.match(r.get("title") or ""):
        m["title"] = r["title"]
    if r.get("sharers") != "unknown" and m.get("sharers") == "unknown":
        m["sharers"] = r["sharers"]
    if (r.get("checked") or "") > (m.get("checked") or ""):
        m["checked"] = r["checked"]
    if r.get("not_same"):
        m["not_same"] = sorted(set(m.get("not_same", []) + r["not_same"]))


def drop_repeated_notes(listings):
    fixed = 0
    for r in listings:
        notes = list(dict.fromkeys(r.get("notes", [])))
        if len(notes) != len(r.get("notes", [])):
            r["notes"] = notes
            fixed += 1
    return fixed


def main(dry, path=LISTINGS, notes_only=False):
    listings = json.load(open(path, encoding="utf-8"))
    kept, merged, by_link = [], [], 0
    if not notes_only:
        owner = {}
        for r in listings:
            m = next((owner[k] for k in keys(r.get("links", []) + [r.get("url", "")]) if k in owner and not apart(owner[k], r)), None)
            if m:
                absorb(m, r, True)
                merged.append(f"{r['id']} -> {m['id']} (shared link)")
            else:
                kept.append(r)
                m = r
            for k in keys(m.get("links", []) + [m.get("url", "")]):
                owner.setdefault(k, m)
        by_link, listings, kept = len(merged), kept, []
        for r in listings:
            # not_same: homes split apart by hand (split_merged.py) after being wrongly merged
            others = [k for k in kept if not apart(k, r)]
            m = None
            if r["status"] != "gone":
                m = same_home(others, r.get("title"), r.get("rent"), r.get("beds"), r.get("baths"), r.get("links", []), r.get("available"))
                m = m or agent_twin(others, r)
            if not m:
                kept.append(r)
                continue
            absorb(m, r, False)
            merged.append(f"{r['id']} -> {m['id']}")
        listings = kept
    notes = drop_repeated_notes(listings)
    if not dry:
        json.dump(listings, open(path, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    for line in merged:
        print("  " + line)
    print(f"merged {len(merged)} duplicates ({by_link} by shared link); {notes} homes had repeated notes; {len(listings)} homes left")


if __name__ == "__main__":
    args = sys.argv[1:]
    main("--dry-run" in args, Path(args[args.index("--file") + 1]) if "--file" in args else LISTINGS, "--notes-only" in args)

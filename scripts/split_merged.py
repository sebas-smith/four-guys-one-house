"""One-off: split homes that were wrongly merged into one record (25 Oct 2026).

Usage: python scripts/split_merged.py [--dry-run]

Each entry below was checked by opening the adverts (Rightmove, OnTheMarket, Zoopla, and the
Jacksons pages in a browser). The original id stays with the home it names. A split-off home whose
adverts are let or taken down is marked gone with off_market, as check_live.py would. A status one
of us set stays with the home it was set on. Homes split apart get each other in `not_same`, so
dedupe.py never merges them again. Homes with adverts check_live.py can read are flagged
(sweep_gone: "recheck"); run `python scripts/check_live.py --added 1900-01-01` afterwards.
Safe to run twice: links already moved are skipped.
"""
import datetime
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LISTINGS = ROOT / "data" / "listings.json"
PERSON_SET = {"shortlist", "viewing", "applied", "no"}
READABLE = ("rightmove", "onthemarket", "zoopla", "openrent", "foxtons")

RM, OTM, ZP = "https://www.rightmove.co.uk/properties/", "https://www.onthemarket.com/details/", "https://www.zoopla.co.uk/to-rent/details/"

# main: what changes on the record that keeps its id. new: homes split off it.
# elsewhere: links that belong to another existing home (moved there if it lacks them).
# drop_notes / carry_notes: note text (substrings) to take off the main home / copy to the new one.
SPLITS = [
    {
        "id": "openrent-2957437", "why": "the Foxtons Firstway house (£4,000, short let £5,000) is a different house",
        "elsewhere": {"foxtons-chpk2578916": [
            RM + "94224747", RM + "94224756", OTM + "20528766/", OTM + "20528767/", ZP + "74488367/", ZP + "74488368/",
            "https://www.foxtons.co.uk/properties-to-rent/sw20/chpk2578916"]},
    },
    {
        "id": "jacksons-20294896", "why": "Jacksons' Squarey Street house (let) and KFH's (refurbished, live) are different houses",
        "main": {"rent": 4250, "prices": [["2026-09-25", 4250, "jacksonsestateagents"]], "gone": "Let agreed on Jacksons",
                 "available": ""},
        "drop_notes": ["Prices differ across sites", "Advert live on Zoopla"],
        "elsewhere": {"jacksons-21403304": ["https://www.jacksonsestateagents.com/properties/21403304/lettings"]},
        "new": [{
            "id": "rightmove-94271229", "title": "Squarey Street, Earlsfield, London, SW17", "rent": 4300, "beds": 4, "baths": 2,
            "available": "2026-11-20", "added": "2026-10-18",
            "links": [RM + "94271229", ZP + "74500221/", OTM + "20545150/",
                      "https://www.kfh.co.uk/property-to-rent/4-bedroom-terraced-house-to-rent-in-squarey-street-earlsfield-london-sw17-89927/"],
            "prices": [["2026-10-18", 4500, "zoopla"], ["2026-10-19", 4300, "rightmove"]],
            "carry_notes": ["Found by ChatGPT sweep", "Advert live on Zoopla"],
        }],
    },
    {
        "id": "jacksons-20627612", "why": "Jacksons' Garratt Lane house (let, £4,500) and Dexters' (live, £4,700) are different houses",
        "main": {"rent": 4500, "prices": [["2026-09-25", 4500, "jacksonsestateagents"]], "gone": "Let agreed on Jacksons"},
        "drop_notes": ["Prices differ across sites", "Advert live on Rightmove"],
        "new": [{
            "id": "rightmove-93951570", "title": "Garratt Lane, Tooting, SW17", "rent": 4700, "beds": 4, "baths": 3,
            "available": "", "added": "2026-09-25",
            "links": [RM + "93951570", OTM + "20480305/", ZP + "74425759/",
                      "https://www.dexters.co.uk/property-for-rent/house-to-rent-in-garratt-lane-london-sw17/285401"],
            "prices": [["2026-10-18", 4700, "rightmove"]],
            "carry_notes": ["Advert live on Rightmove"],
        }],
    },
    {
        "id": "rightmove-93149787", "why": "KFH's let-agreed Sefton Street advert is an older, different letting from Savills' live one",
        "drop_notes": ["Let agreed on OnTheMarket, still live on Rightmove"],
        "new": [{
            "id": "onthemarket-18656989", "title": "Sefton Street, West Putney, London, SW15", "rent": 4500, "beds": 4, "baths": 2,
            "available": "", "added": "2026-10-18", "links": [OTM + "18656989/"],
            "prices": [["2026-10-18", 4500, "onthemarket"]], "gone": "Let agreed on OnTheMarket",
            "carry_notes": ["Let agreed on OnTheMarket"],
        }],
    },
    {
        "id": "rightmove-93328425", "why": "John D Wood's Bucharest Road house (3 baths, let) and Dexters' (2 baths, live) are different houses",
        "main": {"prices": [["2026-10-18", 4995, "onthemarket"], ["2026-10-20", 4995, "rightmove"]]},
        "drop_notes": ["conflicting let-agreed advert", "Let agreed on OnTheMarket, still live on OnTheMarket"],
        "new": [{
            "id": "onthemarket-19872255", "title": "Bucharest Road, London, SW18", "rent": 5000, "beds": 5, "baths": 3,
            "available": "", "added": "2026-10-18", "links": [OTM + "19872255/", RM + "90541779"],
            "prices": [["2026-10-18", 5000, "onthemarket"]], "gone": "Let agreed on OnTheMarket",
            "carry_notes": ["Let agreed on OnTheMarket"],
        }],
    },
]


def main_url(links):
    return next((u for k in ("rightmove", "zoopla", "onthemarket", "openrent") for u in links if k in u), links[0] if links else "")


def mark_gone(home, why, today):
    home["off_market"] = {"why": why, "checked": today}
    if home["status"] not in PERSON_SET:
        home["status"] = "gone"


def main(dry):
    listings = json.load(open(LISTINGS, encoding="utf-8"))
    by_id = {r["id"]: r for r in listings}
    today = datetime.date.today()
    iso, day = today.isoformat(), f"{today.day} {today:%b}"
    made, touched = [], set()
    for spec in SPLITS:
        home = by_id.get(spec["id"])
        if not home:
            print(f"skip {spec['id']}: not found")
            continue
        changed = False
        for owner_id, urls in spec.get("elsewhere", {}).items():
            owner = by_id[owner_id]
            for u in urls:
                if u in home["links"]:
                    home["links"].remove(u)
                    changed = True
                    touched.add(owner_id)
                    if u not in owner["links"]:
                        owner["links"].append(u)
        for new in spec.get("new", []):
            links = [u for u in new["links"] if u in home["links"]]
            if not links or new["id"] in by_id:
                continue
            home["links"] = [u for u in home["links"] if u not in links]
            rec = {
                "id": new["id"], "title": new["title"], "area": home.get("area", ""), "rent": new["rent"], "beds": new["beds"],
                "baths": new["baths"], "available": new["available"], "sharers": "unknown", "status": "new",
                "url": main_url(links), "links": links, "source": home.get("source", ""), "added": new["added"],
                "checked": home.get("checked", iso),
                "notes": [n for n in home.get("notes", []) if any(c in n for c in new.get("carry_notes", []))]
                + [f"Split from {home['id']} ({day}): {spec['why']}."],
                "prices": new["prices"], "not_same": [home["id"]],
            }
            if home.get("station"):
                rec["station"] = dict(home["station"])
            if new.get("gone"):
                mark_gone(rec, new["gone"], iso)
            listings.append(rec)
            by_id[rec["id"]] = rec
            home.setdefault("not_same", []).append(rec["id"])
            home.setdefault("notes", []).append(f"Split off {rec['id']} ({day}): {spec['why']}.")
            made.append(rec)
            changed = True
        if not changed:
            continue
        touched.add(home["id"])
        home["notes"] = [n for n in home.get("notes", []) if not any(d in n for d in spec.get("drop_notes", []))]
        if not spec.get("new"):
            home["notes"].append(f"Removed adverts of another home ({day}): {spec['why']}.")
        main = spec.get("main", {})
        for f in ("rent", "prices", "available"):
            if f in main:
                home[f] = main[f]
        if main.get("gone"):
            mark_gone(home, main["gone"], iso)
        elif home.get("off_market") and spec.get("new"):
            home.pop("off_market")  # it may have come from a split-off advert; check_live.py decides again
        if home.get("url") not in home["links"]:
            home["url"] = main_url(home["links"])
    for r in listings:
        if r["id"] in touched or r in made:
            if any(k in u for u in r["links"] for k in READABLE):
                r["sweep_gone"] = "recheck"
            print(f"{r['id']:24} {r['status']:5} £{r['rent']:,} {r['beds']}/{r['baths']}  {r['title'][:38]:38} "
                  f"{(r.get('off_market') or {}).get('why', '')}")
            for u in r["links"]:
                print("    ", u)
    if not dry:
        json.dump(listings, open(LISTINGS, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(f"{len(made)} homes split off; {len(touched)} existing homes changed")


if __name__ == "__main__":
    main("--dry-run" in sys.argv)

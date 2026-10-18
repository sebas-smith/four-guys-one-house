"""Open each live home's advert and mark it gone when it's let agreed, under offer or taken down.

Usage: python scripts/check_live.py [--added YYYY-MM-DD] [--dry-run]

Reads the pages directly (Rightmove, OnTheMarket, Zoopla, OpenRent, Foxtons; other sites only
when they return 404/410). A home is off the market if an advert says let agreed or under offer,
or has been taken down, and no other advert is live. Let agreed on one site but live on another
gets a warning but stays on the list. Homes a person has moved on
(shortlist, viewing, applied) keep their status and get a note; new ones are marked gone. A home
the checker marked gone comes back if an advert is live again. Sites that block us are skipped.
--added only checks homes added on that date (used after a sweep).
"""
import datetime
import json
import re
import sys
import time
from pathlib import Path

from curl_cffi import requests

ROOT = Path(__file__).resolve().parent.parent
LISTINGS = ROOT / "data" / "listings.json"
PERSON_SET = {"shortlist", "viewing", "applied", "no"}
NAMES = {"rightmove": "Rightmove", "onthemarket": "OnTheMarket", "zoopla": "Zoopla", "openrent": "OpenRent", "foxtons": "Foxtons"}


def site_of(url):
    return url.split("/")[2].replace("www.", "").split(".")[0]


def name(url):
    return NAMES.get(site_of(url), site_of(url))


def verdict(url, code, final, html):
    """'let', 'removed', 'live' or None (couldn't tell)."""
    site = site_of(url)
    if code in (404, 410):
        return "removed"
    if code != 200:
        return None
    if site == "rightmove":
        if re.search(r">\s*(LET AGREED|UNDER OFFER)\s*<|\\?\"(LET_AGREED|UNDER_OFFER)\\?\"", html):
            return "let"
        return "live" if "/properties/" in final else "removed"
    if site == "onthemarket":
        if "/details/" not in final:
            return "removed"
        return "let" if re.search(r'"labelText":"(Let agreed|Under offer)"', html, re.I) else "live"
    if site == "zoopla":
        if "/to-rent/details/" not in final:
            return "removed"  # Zoopla sends taken-down adverts to the address page
        status = re.search(r'listingStatus\\?":\\?"(\w+)', html)
        if not status:
            return None
        return "live" if status.group(1) == "to_rent" else "let"
    if site == "openrent":
        if re.search(r"Let Agreed - This property is no longer available", html, re.I):
            return "let"
        return "live" if re.search(r"/\d+/?$", final) else "removed"
    if site == "foxtons":
        return "removed" if "#gone" in final or final.rstrip("/") != url.rstrip("/") else "live"
    return None


def fetch(url):
    try:
        r = requests.get(url, impersonate="chrome", timeout=25)
        return r.status_code, r.url, r.text
    except Exception as e:  # noqa: BLE001 - network trouble just means "couldn't tell"
        print(f"  skip {url}: {e}"[:150])
        return None, url, ""


def main():
    args = sys.argv[1:]
    only = args[args.index("--added") + 1] if "--added" in args else None
    today = datetime.date.today().isoformat()
    day = f"{datetime.date.today().day} {datetime.date.today():%b}"
    listings = json.load(open(LISTINGS, encoding="utf-8"))
    gone = back = checked = 0
    for home in listings:
        mine = bool(home.get("off_market"))
        if only and home.get("added") != only:
            continue
        if home.get("status") == "gone" and not mine:
            continue
        results = {}
        for url in home.get("links") or [home.get("url")]:
            if not url:
                continue
            results[url] = verdict(url, *fetch(url))
            time.sleep(0.7)
        checked += 1
        let = [u for u, v in results.items() if v == "let"]
        removed = [u for u, v in results.items() if v == "removed"]
        live = [u for u, v in results.items() if v == "live"]
        if let or (removed and not live):
            u = (let or removed)[0]
            why = f"{'Let agreed' if let else 'Advert taken down'} on {name(u)}"
            if live:  # often an old advert of a relisted home, or an agent slow to update one site
                why += f", still live on {name(live[0])}"
            if home.get("off_market", {}).get("why") != why:
                home["off_market"] = {"why": why, "checked": today}
                home.setdefault("notes", []).append(f"{why} ({day}).")
                if home["status"] not in PERSON_SET:
                    home["status"] = "new" if live else "gone"
                gone += 1
                print(f"gone  {home['title'][:40]:40} {why}  {u}")
            home["off_market"]["checked"] = today
        elif live and mine:
            del home["off_market"]
            if home["status"] == "gone":
                home["status"] = "new"
            home.setdefault("notes", []).append(f"Advert live again on {name(live[0])} ({day}).")
            back += 1
            print(f"back  {home['title'][:40]}")
        if checked % 50 == 0:
            print(f"... {checked} homes checked")
    if "--dry-run" not in args:
        json.dump(listings, open(LISTINGS, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(f"{checked} homes checked: {gone} newly off the market, {back} back on")


if __name__ == "__main__":
    main()

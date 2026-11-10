"""Open each live home's advert and mark it gone when it's let agreed, under offer or taken down.

Usage: python scripts/check_live.py [--added YYYY-MM-DD | --ids a,b,...] [--file listings.json] [--dry-run]

Reads the pages directly (Rightmove, OnTheMarket, Zoopla, OpenRent, Foxtons, Marsh & Parsons via its
API, since its let adverts stay up unlabelled; other sites only
when they return 404/410). A home is off the market if an advert says let agreed or under offer,
or has been taken down, and no other advert is live. Let agreed on one site but live on another
gets a warning but stays on the list. Homes a person has moved on
(shortlist, viewing, applied) keep their status and get a note; new ones are marked gone. A home
the checker marked gone comes back if an advert is live again. Sites that block us are skipped.
Homes the ChatGPT sweep says are let (sweep_gone) are checked the same way; if none of their
adverts can be read, the sweep's word stands.
--added only checks homes added on that date, plus any the sweep flagged; --ids only checks those
homes, plus any flagged (used after a sweep). An advert only counts as taken down on a 404/410 or
when the site sends us to its search or address page; a block or captcha page counts as unknown.
A home with no photo gets the first live advert's main photo.
"""
import datetime
import json
import re
import sys
import time
from pathlib import Path

from curl_cffi import CurlHttpVersion, requests

sys.path.insert(0, str(Path(__file__).parent))
from ingest_alerts import same_price, shown_rent  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
LISTINGS = ROOT / "data" / "listings.json"
PERSON_SET = {"shortlist", "viewing", "applied", "no"}
NAMES = {"rightmove": "Rightmove", "onthemarket": "OnTheMarket", "zoopla": "Zoopla", "openrent": "OpenRent", "foxtons": "Foxtons"}


def site_of(url):
    return url.split("/")[2].replace("www.", "").split(".")[0]


def name(url):
    return NAMES.get(site_of(url), site_of(url))


def blocked(html):
    """A rate-limit, captcha or bot-check page instead of the advert."""
    title = re.search(r"<title[^>]*>(.*?)</title>", html[:20000], re.S | re.I)
    title = title.group(1) if title else ""
    return len(html) < 5000 or bool(re.search(r"captcha|just a moment|access denied|attention required|pardon our interruption|too many requests|are you a robot", title, re.I))


def verdict(url, code, final, html):
    """'let', 'removed', 'live' or None (couldn't tell)."""
    site = site_of(url)
    if code in (404, 410):
        return "removed"
    if code != 200 or blocked(html):
        return None
    path = re.sub(r"^https?://[^/]+|[?#].*$", "", final)
    if site == "rightmove":
        if re.search(r">\s*(LET AGREED|UNDER OFFER)\s*<|\\?\"(LET_AGREED|UNDER_OFFER)\\?\"", html):
            return "let"
        if "/properties/" in final:
            return "live"
        return "removed" if path in ("", "/") or path.startswith(("/property-to-rent", "/find")) else None
    if site == "onthemarket":
        if "/details/" not in final:
            return "removed" if path in ("", "/") or path.startswith("/to-rent") else None
        # Withdrawn adverts stay up ("no longer on the market") with status "retracted"
        status = re.search(r'"http-status":"\d+","status":"(\w+)"', html)
        if status and status.group(1) != "live":
            return "removed"
        return "let" if re.search(r'"labelText":"(Let agreed|Under offer)"', html, re.I) else "live"
    if site == "zoopla":
        if "/to-rent/details/" not in final:
            # Zoopla sends taken-down adverts to the address page
            return "removed" if path.startswith(("/to-rent/property/", "/to-rent/map/", "/search")) else None
        status = re.search(r'listingStatus\\?":\\?"(\w+)', html)
        if not status:
            return None
        return "live" if status.group(1) == "to_rent" else "let"
    if site == "openrent":
        if re.search(r"Let Agreed - This property is no longer available", html, re.I):
            return "let"
        if re.search(r"/\d+/?$", final):
            return "live"
        return "removed" if path in ("", "/") or "properties-to-rent" in path else None
    if site == "foxtons":
        # Taken-down adverts redirect to the area page with #gone; other redirects happen when it's slow
        if "#gone" in final:
            return "removed"
        if final.split("#")[0].rstrip("/") != url.rstrip("/"):
            return None
        # Foxtons leaves let adverts up: DOW/EXC is let, OWB/ACC, OWB/INS or POV/INS live
        pub = re.search(r'"webPublishStatus":"(\w+)","status":"(\w+)"', html)
        if not pub:
            return None
        return "let" if "DOW" in pub.groups() or "EXC" in pub.groups() else "live"
    if site == "marshandparsons":
        # M&P keeps let adverts up with no label; its own API has the real status
        pid = re.search(r"if\(b == '([0-9a-f]{24})'\)", html)
        if not pid:
            return None
        try:
            found = requests.get(f"https://api.marshandparsons.co.uk/api/properties?ids={pid.group(1)}", impersonate="chrome", timeout=40).json().get("properties")
        except Exception:  # noqa: BLE001
            return None
        if not found:
            return "removed"
        rps = found[0].get("rawRPSData", {})
        if not rps.get("InternalLettingStatus"):
            return None
        if rps["InternalLettingStatus"] != "To Let" or found[0].get("redTag"):
            return "let"
        return "live" if rps.get("MarketedOnInternet") else "removed"
    return None


def photo(url, html):
    """The advert's main photo, or None: Rightmove's first property photo, else the page's og:image."""
    m = re.search(r"https://media\.rightmove\.co\.uk/dir/property-photo/[^\"'\s\\]+?\.jpe?g", html)
    if m:
        return re.sub(r"_max_\d+x\d+", "_max_476x317", m.group(0))
    m = re.search(r'<meta[^>]+property="og:image"[^>]+content="([^"]+)"|<meta[^>]+content="([^"]+)"[^>]+property="og:image"', html)
    pic = m and (m.group(1) or m.group(2))
    if pic and pic.startswith("/"):
        pic = re.match(r"https://[^/]+", url).group(0) + pic
    if not pic or not pic.startswith("https://") or re.search(r"logo|share-graphic|placeholder|default", pic, re.I):
        return None
    return pic


COORDS = [  # (site or "", pattern giving lat then lon, or lon then lat when the name ends in "lonlat")
    ("rightmove", r'(5[01]\.\d{3,}),(-?[01]\.\d{3,}),\d+,\d+,\\?"(?:ACCURATE_POINT|APPROXIMATE)'),
    ("onthemarket lonlat", r'"location":\{"lon":(-?[01]\.\d{3,}),"lat":(5[01]\.\d{3,})\},"breadcrumbs"'),
    ("zoopla lonlat", r"marker=(-?[01]\.\d{3,})%2C(5[01]\.\d{3,})"),
    ("openrent", r'data-lat="(5[01]\.\d{3,})"\s+data-lng="(-?[01]\.\d{3,})"'),
    ("", r'"latitude":\s*"?(5[01]\.\d{3,})"?,\s*"longitude":\s*"?(-?[01]\.\d{3,})'),  # schema.org (Foxtons, agents)
]


def coords(url, html):
    """[lat, lon] of the home from its advert page, or None. Only positions in Greater London count."""
    site = site_of(url)
    for name, rx in COORDS:
        if name and name.split()[0] != site:
            continue
        m = re.search(rx, html)
        if m:
            a, b = float(m.group(1)), float(m.group(2))
            lat, lon = (b, a) if name.endswith("lonlat") else (a, b)
            if 51.25 < lat < 51.72 and -0.55 < lon < 0.35:
                return [lat, lon]
    return None


def asking(url, html):
    """The monthly rent a live Rightmove or OnTheMarket advert asks, or None."""
    site = site_of(url)
    if site == "rightmove":
        m = re.search(r"content='\d+ bedroom [^']*? for \D{1,8}([\d,]{4,7}) pcm", html)
        return int(m.group(1).replace(",", "")) if m else None
    if site == "onthemarket":
        m = re.search(r'"priceRaw":(\d{4,5})\b', html)
        weekly = re.search(r'"priceRaw":\d+[^{}]{0,200}?\b(pw|per week)\b', html)
        return int(m.group(1)) if m and not weekly else None
    return None


def reprice(home, asks, today, day):
    """Record what each live advert asks and show the lowest current price. True when the rent changed.

    asks is {site: lowest rent its live adverts ask}. A price more than 25% from the shown rent is
    probably misread, so it's printed and ignored. A price within £4 (JITTER) of that site's last one, or
    of the shown rent when the site has none, is a weekly price converted back slightly off: ignored too.
    """
    old = home["rent"]
    for site, price in asks.items():
        if abs(price - old) > 0.25 * old:
            print(f"  ? {home['id']}: {site} asks £{price:,}, shown £{old:,}; not changed")
            continue
        latest = [p for p in home.get("prices") or [] if p[2] == site]
        if latest and not same_price(latest[-1][1], price) or not latest and (price == old or not same_price(old, price)):
            home.setdefault("prices", []).append([today, price, site])
    home["rent"] = shown_rent(home)
    if home["rent"] == old:
        return False
    change = "cut" if home["rent"] < old else "rise"
    add_note(home, f"Price {change}: £{old:,} to £{home['rent']:,} on the live adverts ({day}).")
    print(f"rent  {home['title'][:40]:40} £{old:,} -> £{home['rent']:,}")
    return True


def ruled_out(home):
    """Already off our list: status "no" (out of area, excluded area or no sharers; merge_sweep.py gives the
    reason in `ruled_out`). Such a home going let isn't news, so it doesn't count as newly off the market."""
    return home.get("status") == "no" or bool(home.get("ruled_out"))


def add_note(home, text):
    """Add a note unless it's there already, or the latest note says the same on an earlier day."""
    notes = home.setdefault("notes", [])
    stem = re.sub(r"\s*\([^()]*\)\.$", "", text)
    if text not in notes and not (notes and notes[-1].startswith(stem + " (")):
        notes.append(text)


HOLD_DAYS = 5  # a home held as "not checked yet" for this long with no sweep saying live is marked gone
RECHECK = ROOT / "data" / "recheck.json"


def hold(home, today):
    """True while a home whose readable adverts are down should stay listed (first held under HOLD_DAYS ago)."""
    first = home.setdefault("unconfirmed", today)
    return (datetime.date.fromisoformat(today) - datetime.date.fromisoformat(first)).days < HOLD_DAYS


def write_recheck(listings):
    """data/recheck.json: held homes the ChatGPT sweep should open (adverts GitHub can't read)."""
    rows = [{"id": h["id"], "title": h["title"], "rent": h.get("rent"), "why": h["off_market"]["why"],
             "since": h.get("unconfirmed"), "links": [u for u in h.get("links", []) if u not in h.get("down", [])]}
            for h in listings if h.get("off_market", {}).get("unconfirmed") and h.get("status") != "gone"]
    json.dump(rows, open(RECHECK, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    return len(rows)


def fetch(url):
    try:
        try:
            r = requests.get(url, impersonate="chrome", timeout=25)
        except requests.RequestsError as e:
            if "(92)" not in str(e):
                raise
            # Dexters sends a header HTTP/2 rejects; HTTP/1.1 reads it fine
            r = requests.get(url, impersonate="chrome", timeout=25, http_version=CurlHttpVersion.V1_1)
        return r.status_code, r.url, r.text
    except Exception as e:  # noqa: BLE001 - network trouble just means "couldn't tell"
        print(f"  skip {url}: {e}"[:150])
        return None, url, ""


def main():
    args = sys.argv[1:]
    only = args[args.index("--added") + 1] if "--added" in args else None
    ids = set(filter(None, args[args.index("--ids") + 1].split(","))) if "--ids" in args else None
    path = Path(args[args.index("--file") + 1]) if "--file" in args else LISTINGS
    today = datetime.date.today().isoformat()
    day = f"{datetime.date.today().day} {datetime.date.today():%b}"
    listings = json.load(open(path, encoding="utf-8"))
    gone = back = checked = warned = unread = repriced = held = 0
    unread_by = {}
    for home in listings:
        mine = bool(home.get("off_market"))
        flagged = home.get("sweep_gone")
        if only and home.get("added") != only and not flagged:
            continue
        if ids is not None and home["id"] not in ids and not flagged:
            continue
        if home.get("status") == "gone" and not mine and not flagged:
            continue
        results, asks = {}, {}
        links = [u for u in home.get("links") or [home.get("url")] if u]
        for url in links:
            code, final, html = fetch(url)
            results[url] = verdict(url, code, final, html)
            if results[url] == "live":
                pic = None if home.get("photo") else photo(url, html)
                if pic:
                    home["photo"] = pic
                price = asking(url, html)
                if price:
                    asks[site_of(url)] = min(price, asks.get(site_of(url), price))
            time.sleep(0.7)
        checked += 1
        unread += sum(v is None for v in results.values())
        for u, v in results.items():
            if v is None:
                unread_by[name(u)] = unread_by.get(name(u), 0) + 1
        let = [u for u, v in results.items() if v == "let"]
        removed = [u for u, v in results.items() if v == "removed"]
        live = [u for u, v in results.items() if v == "live"]
        # Adverts found let or taken down while the home is still listed: the site skips them as the main link
        # and same_home treats a new advert for the same street, beds and rent as a relist.
        down = (set(home.get("down", [])) - set(live) | set(let) | set(removed)) & set(links)
        if down:
            home["down"] = [u for u in links if u in down]
        else:
            home.pop("down", None)
        # A let advert only warns when no other advert on that site is live (else it's an old one of a relist)
        live_sites = {site_of(u) for u in live}
        warn = [u for u in let if site_of(u) not in live_sites]
        was = home["status"]
        unknown = [u for u, v in results.items() if v is None]
        if live or not (let or removed):
            home.pop("unconfirmed", None)
        if (let or removed) and not live and unknown and not flagged and was != "gone" and hold(home, today):
            # Down where we can read, but other adverts (Zoopla, OpenRent, agents block GitHub) might still be
            # live: keep it listed with a warning, and list it in data/recheck.json for the ChatGPT sweep.
            u = (let or removed)[0]
            why = f"{'Let agreed' if let else 'Taken down'} on {name(u)}; {name(unknown[0])} advert not checked yet"
            if home.get("off_market", {}).get("why") != why:
                add_note(home, f"{why} ({day}).")
                print(f"hold  {home['title'][:40]:40} {why}")
                held += 1
            home["off_market"] = {"why": why, "checked": today, "unconfirmed": True}
        elif (let or removed) and not live:
            u = (let or removed)[0]
            why = f"{'Let agreed' if let else 'Advert taken down'} on {name(u)}"
            if home.get("off_market", {}).get("why") != why:
                home["off_market"] = {"why": why, "checked": today}
                add_note(home, f"{why} ({day}).")
            if home["status"] not in PERSON_SET:
                home["status"] = "gone"
            if was != "gone" and not ruled_out(home):
                gone += 1
                print(f"gone  {home['title'][:40]:40} {why}  {u}")
            home["off_market"]["checked"] = today
        elif live and warn:  # often an agent slow to update one site
            why = f"Let agreed on {name(warn[0])}, still live on {name(live[0])}"
            if home.get("off_market", {}).get("why") != why:
                home["off_market"] = {"why": why, "checked": today}
                add_note(home, f"{why} ({day}).")
                warned += 1
                print(f"warn  {home['title'][:40]:40} {why}  {warn[0]}")
            if home["status"] == "gone":
                home["status"] = "new"
                back += 1
            home["off_market"]["checked"] = today
        elif live and (mine or flagged):
            home.pop("off_market", None)
            if home["status"] == "gone":
                home["status"] = "new"
                back += 1
                print(f"back  {home['title'][:40]}")
            add_note(home, f"Advert live on {name(live[0])} ({day}).")
        elif flagged and not any(results.values()):
            # Nothing we can read (agent sites, Zoopla or OpenRent blocking us): go with the sweep.
            # A later sweep saying live undoes this (merge_sweep.py).
            said = next((n for n in reversed(home.get("notes", [])) if n.startswith("ChatGPT sweep says ")), "")
            why = "ChatGPT sweep says " + ("removed" if "removed" in said.lower() else "let agreed")
            home["off_market"] = {"why": why, "checked": today}
            if home["status"] not in PERSON_SET:
                home["status"] = "gone"
            if was != "gone" and not ruled_out(home):
                gone += 1
                print(f"gone  {home['title'][:40]:40} {why}")
        home.pop("sweep_gone", None)
        if asks and live and home.get("rent"):
            if reprice(home, asks, today, day):
                repriced += 1
        if any(results.values()):
            home["checked"] = today  # the sweep only rechecks homes this script can't read
        if checked % 50 == 0:
            print(f"... {checked} homes checked")
    if "--dry-run" not in args:
        json.dump(listings, open(path, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
        if path == LISTINGS:
            print(f"{write_recheck(listings)} homes held for the ChatGPT sweep to recheck (data/recheck.json)")
    print(f"{checked} homes checked: {gone} newly off the market, {back} back on, {warned} newly let on one site "
          f"but live on another, {repriced} rents changed, {held} newly held (readable adverts down, others unread), "
          f"{unread} adverts couldn't be read")
    if unread_by:
        print("  couldn't read: " + ", ".join(f"{k} {v}" for k, v in sorted(unread_by.items(), key=lambda x: -x[1])))


if __name__ == "__main__":
    main()

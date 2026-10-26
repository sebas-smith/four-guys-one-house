"""Read listing emails from the bot inbox and add new homes to data/listings.json.

Picks up any Rightmove, Zoopla, OnTheMarket or OpenRent listing link in any email
(portal alerts, or a listing someone forwarded), so it doesn't depend on one email layout.

Env: GMAIL_ADDRESS, GMAIL_APP_PASSWORD. Optional: LOOKBACK_DAYS (default 7), DRY_RUN=1.
Exits 1 if a portal email contained no listing we could read, so the Action fails loudly.
"""
import datetime as dt
import email
import html
import imaplib
import json
import os
import re
import sys
import urllib.request
from email.header import decode_header, make_header
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
LISTINGS = ROOT / "data" / "listings.json"
PROCESSED = ROOT / "data" / "processed_emails.json"

# (portal, regex for a canonical listing URL, canonical URL template)
PORTALS = [
    ("rightmove", re.compile(r"rightmove\.co\.uk/(?:properties|property-to-rent/property)-?/?(\d{6,})"), "https://www.rightmove.co.uk/properties/{}"),
    ("zoopla", re.compile(r"zoopla\.co\.uk/to-rent/details/(\d{6,})"), "https://www.zoopla.co.uk/to-rent/details/{}/"),
    ("onthemarket", re.compile(r"onthemarket\.com/details/(\d{5,})"), "https://www.onthemarket.com/details/{}/"),
    ("openrent", re.compile(r"openrent\.co\.uk/(?:property-to-rent/[^\s\"'<>]*?/|)(\d{6,7})\b"), "https://www.openrent.co.uk/{}"),
]
PORTAL_SENDERS = ("rightmove", "zoopla", "onthemarket", "openrent")
TRACKING_HOST = re.compile(r"https?://[^\s\"'<>]*(?:rightmove|zoopla|onthemarket|openrent)[^\s\"'<>]*", re.I)
MIN_RENT, MAX_RENT, MIN_BEDS = 3000, 5000, 4
EXCLUDED_AREAS = re.compile(r"isleworth|osterley|new malden|hounslow|twickenham|whitton|brixton|streatham|\b(TW[1-9]|KT3|SW2|SW16|SE\d{1,2})\b", re.I)


def decoded(value):
    return str(make_header(decode_header(value or "")))


def body_text(msg):
    """Return (html_or_text, plain_text) for the whole message."""
    parts = []
    for part in msg.walk():
        if part.get_content_type() in ("text/html", "text/plain") and not part.get_filename():
            payload = part.get_payload(decode=True) or b""
            parts.append(payload.decode(part.get_content_charset() or "utf-8", errors="replace"))
    raw = "\n".join(parts)
    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", raw, flags=re.S | re.I)
    text = re.sub(r"<br\s*/?>|</(p|div|tr|td|li|h\d)>", "\n", text, flags=re.I)
    text = html.unescape(re.sub(r"<[^>]+>", " ", text))
    text = re.sub(r"[ \t\xa0]+", " ", text)
    return raw, text


def resolve(url):
    """Follow a tracking redirect to the real listing URL (no body download)."""
    try:
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.geturl()
    except Exception:
        return url


def find_listings(raw):
    """Return {(portal, id): position_in_raw} for every listing link, resolving tracking links."""
    found = {}
    candidates = [(m.start(), html.unescape(m.group(0))) for m in TRACKING_HOST.finditer(raw)]
    for pos, url in candidates:
        hits = [(p, rx.search(url)) for p, rx, _ in PORTALS]
        hits = [(p, m) for p, m in hits if m]
        if not hits and len(found) < 60:
            real = resolve(url)
            hits = [(p, rx.search(real)) for p, rx, _ in PORTALS]
            hits = [(p, m) for p, m in hits if m]
        for p, m in hits:
            found.setdefault((p, m.group(1)), pos)
    return found


PRICE = re.compile(r"£\s?([\d,]{3,7})\s*(pcm|per month|pw|per week|/month|/week)?", re.I)
BEDS = re.compile(r"(\d+)\s*(?:bed|bedroom)", re.I)
ADDRESS = re.compile(r"[^<>\n|]{0,80}\b(?:(?:SW|SE|KT|TW|CR|SM)\d{1,2}\b|London|Road|Street|Avenue|Lane|Gardens|Close|Way|Grove|Place)[^<>\n|]{0,40}")


def details_near(raw, pos, next_pos, prev_pos=None):
    """Pull price, beds and an address from the email around one listing's link.

    Looks between the neighbouring listing links (at most 1500 chars each way) and takes
    the match closest to this link, so one listing never borrows another's price.
    """
    start = max(0, pos - 1500, prev_pos or 0)
    end = min(len(raw), pos + 1500, next_pos or len(raw))
    chunk = html.unescape(raw[start:end]).replace("\xa0", " ")
    chunk = re.sub(r"<(?:br|/p|/div|/tr|/td|/li|/h\d)[^>]*>", "\n", chunk, flags=re.I)
    chunk = re.sub(r"<[^>]+>", lambda m: " " * len(m.group(0)), chunk)  # keep offsets stable
    here = pos - start

    def closest(rx):
        # Alert layouts put details after the link; fall back to the nearest one before it.
        ms = list(rx.finditer(chunk))
        after = [m for m in ms if m.start() >= here]
        if after:
            return after[0]
        return max(ms, key=lambda m: m.start()) if ms else None

    rent = None
    m = closest(PRICE)
    if m:
        rent = int(m.group(1).replace(",", ""))
        if m.group(2) and "w" in m.group(2).lower():
            rent = round(rent * 52 / 12)
    m = closest(BEDS)
    beds = int(m.group(1)) if m else None
    m = closest(ADDRESS)
    title = re.sub(r"https?://\S+|\s+", " ", m.group(0)).strip(" ,-") if m else ""
    title = re.sub(r"\s+", " ", title)
    return rent, beds, title


def area_from(title):
    for a in ("Putney", "Southfields", "Earlsfield", "Wandsworth", "Tooting", "Balham", "Wimbledon",
              "Raynes Park", "Clapham", "Roehampton", "New Malden", "Colliers Wood", "Fulham", "Hammersmith",
              "Chiswick", "Shepherd's Bush", "Shepherds Bush", "Battersea"):
        if a.lower() in title.lower():
            return a
    m = re.search(r"\b(SW\d{1,2}|SE\d{1,2}|KT\d{1,2}|TW\d{1,2}|CR\d|SM\d)\b", title)
    return m.group(1) if m else ""


STREET = re.compile(r"\b(rd|road|street|avenue|lane|gardens|close|way|grove|place|mews|row|crescent|hill|drive|terrace|"
                    r"square|walk|court|park|rise|vale|green|parade|yard|wharf|house|common)\b", re.I)
MONTHS = {m: i + 1 for i, m in enumerate("jan feb mar apr may jun jul aug sep oct nov dec".split())}


def street(title):
    """The street in a title, lower case, or "" if there isn't one.

    'Mascotte Road, London, SW15' -> 'mascotte road'; '8 Bucharest Road Battersea' -> 'bucharest road';
    'Firstway, London' -> 'firstway'; 'Raynes Park, London' -> ''.
    """
    title = re.sub(r"^\s*\d+\s+bed(room)?s?\b.*?\bto (rent|let)\s*[-–—]\s*", "", title or "", flags=re.I)  # OnTheMarket
    first = re.split(r",|\.\s+(?=[A-Z]{1,2}\d)|\s+[-–—�]\s+", title)[0]
    first = re.sub(r"\s+", " ", first).strip()
    m = ([None] + list(STREET.finditer(first)))[-1]  # last one: "St Ann's Park Road" ends at Road
    if m and not re.fullmatch(r"(raynes|colliers|putney|wimbledon|clapham)\s+\w+", first[:m.end()], re.I):
        return re.sub(r"^\d+\s+", "", first[:m.end()]).lower().replace(" rd", " road")
    return first.lower() if re.search(r"\w(way|heath|view|side)$", first, re.I) else ""


def avail_date(text):
    """'Availability date: 24 Oct 2026', '24/10/2026', '2026-10-24' -> '2026-10-24'; anything else -> None."""
    t = (text or "").lower()
    m = re.search(r"(\d{4})-(\d\d)-(\d\d)", t)
    if m:
        return m.group(0)
    m = re.search(r"\b(\d{1,2})/(\d{1,2})/(\d{4})\b", t)
    if m:
        return f"{m.group(3)}-{int(m.group(2)):02}-{int(m.group(1)):02}"
    m = re.search(r"\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*,?\s+(\d{4})", t)
    if m and m.group(2) in MONTHS:
        return f"{m.group(3)}-{MONTHS[m.group(2)]:02}-{int(m.group(1)):02}"
    return None


def sites(urls):
    return {re.sub(r"^www\.", "", urlparse(u).hostname or "") for u in urls if u}


PORTAL_SITES = {"rightmove.co.uk", "zoopla.co.uk", "onthemarket.com", "openrent.co.uk"}


def same_home(listings, title, rent, beds=None, baths=None, links=(), available=None):
    """An existing home that is the same advert on another portal.

    Same street, beds and baths within £50 counts as the same. Up to 8% apart also counts when beds and
    baths match and both were found on portals but different ones, since a price cut often reaches one
    portal before another. Without a street, rent within £50 plus the same beds, baths and move-in date
    counts. A second advert on a portal the home is already on counts as a different home: streets often
    have several similar homes at one price, and we don't know the agent to tell a relist apart.
    """
    if not rent:
        return None
    hosts, s, when = sites(links), street(title), avail_date(available)

    def same(r):
        if r.get("status") == "gone" or not r.get("rent"):
            return False
        if beds and r.get("beds") and beds != r["beds"]:
            return False
        if baths and r.get("baths") and baths != r["baths"]:
            return False
        theirs = sites(r.get("links", []))
        if hosts & theirs & PORTAL_SITES:
            return False
        other = street(r.get("title"))
        if s and other:
            if s != other:
                return False
            if abs(r["rent"] - rent) <= 50:
                return True
            return bool(beds and baths and baths == r.get("baths") and hosts & PORTAL_SITES
                        and theirs & PORTAL_SITES and not hosts & theirs
                        and abs(r["rent"] - rent) <= 0.08 * max(r["rent"], rent))
        return bool(when and when == avail_date(r.get("available")) and beds and baths
                    and baths == r.get("baths") and abs(r["rent"] - rent) <= 50)

    return next((r for r in listings if same(r)), None)


def site_name(url):
    return re.sub(r"^www\.", "", urlparse(url).hostname or "").split(".")[0] if url else ""


def record_price(home, rent, when, site=""):
    """Add [date, rent, site] to the home's price history when we see a price it hasn't had there before."""
    if not rent:
        return
    history = home.setdefault("prices", [])
    if not any(p[1] == rent and p[2] == site for p in history) or history[-1][1] != rent:
        history.append([when, rent, site])


def merge_price(home, rent, where, when="", site=""):
    """Keep the lower price when two portals disagree, and say so in a note."""
    record_price(home, rent, when, site)
    if rent and home.get("rent") and abs(home["rent"] - rent) > 50:
        note = f"Prices differ across sites: £{max(home['rent'], rent):,} vs £{min(home['rent'], rent):,}. Showing the lower; see price history."
        if note not in home.setdefault("notes", []):
            home["notes"].append(note)
        home["rent"] = min(home["rent"], rent)


def main():
    if not os.environ.get("GMAIL_ADDRESS") or not os.environ.get("GMAIL_APP_PASSWORD"):
        print("Gmail secrets not set yet; skipping.")
        return
    listings = json.load(open(LISTINGS, encoding="utf-8"))
    processed = json.load(open(PROCESSED, encoding="utf-8")) if PROCESSED.exists() else []
    known = set()
    for r in listings:
        for u in r.get("links", []) + [r.get("url", "")]:
            for p, rx, _ in PORTALS:
                m = rx.search(u or "")
                if m:
                    known.add((p, m.group(1)))

    imap = imaplib.IMAP4_SSL("imap.gmail.com")
    imap.login(os.environ["GMAIL_ADDRESS"], os.environ["GMAIL_APP_PASSWORD"])
    imap.select("INBOX", readonly=True)
    since = (dt.date.today() - dt.timedelta(days=int(os.environ.get("LOOKBACK_DAYS", "7")))).strftime("%d-%b-%Y")
    _, data = imap.search(None, "SINCE", since)

    added, failures, today = [], [], dt.date.today().isoformat()
    for num in data[0].split():
        _, msg_data = imap.fetch(num, "(RFC822)")
        msg = email.message_from_bytes(msg_data[0][1])
        mid = msg.get("Message-ID", f"no-id-{num.decode()}")
        if mid in processed:
            continue
        sender, subject = decoded(msg.get("From")).lower(), decoded(msg.get("Subject"))
        raw, _ = body_text(msg)
        found = find_listings(raw)
        if not found and any(s in sender for s in PORTAL_SENDERS) and re.search(r"propert|home|alert|new|price", subject, re.I):
            failures.append(f"{sender} | {subject}")
            continue
        positions = sorted(found.values())
        for (portal, pid), pos in found.items():
            if (portal, pid) in known:
                continue
            nxt = next((p for p in positions if p > pos), None)
            prv = max((p for p in positions if p < pos), default=None)
            rent, beds, title = details_near(raw, pos, nxt, prv)
            if rent and not (MIN_RENT <= rent <= MAX_RENT):
                continue
            if beds and beds < MIN_BEDS:
                continue
            if EXCLUDED_AREAS.search(title):
                continue
            url = dict((p, t) for p, _, t in PORTALS)[portal].format(pid)
            try:
                when = parsedate_to_datetime(msg["Date"]).date().isoformat()
            except Exception:
                when = today
            dup = same_home(listings, title, rent, beds, None, [url])
            if dup:
                dup.setdefault("links", []).append(url)
                merge_price(dup, rent, f"{portal.title()} email {when}", when, portal)
                known.add((portal, pid))
                added.append(f"{portal}-{pid} linked to existing {dup['id']}")
                continue
            listings.append({
                "id": f"{portal}-{pid}", "title": title or f"{portal.title()} listing {pid}", "area": area_from(title),
                "rent": rent, "beds": beds, "baths": None, "available": "", "sharers": "unknown", "status": "new",
                "url": url, "links": [url], "source": "alert", "added": when,
                "notes": [f"From an email on {when}: {subject[:120]}"],
            })
            record_price(listings[-1], rent, when, portal)
            known.add((portal, pid))
            added.append(f"{portal}-{pid} {title} £{rent}")
        processed.append(mid)
    imap.logout()

    if not os.environ.get("DRY_RUN"):
        json.dump(listings, open(LISTINGS, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
        json.dump(processed[-1000:], open(PROCESSED, "w", encoding="utf-8"), indent=1)
    print(f"added {len(added)}")
    for a in added:
        print("  +", a)
    if failures:
        print("Portal emails with no readable listings (parser may need updating):")
        for f in failures:
            print("  !", f)
        sys.exit(1)


if __name__ == "__main__":
    main()

"""Read listing emails from the bot inbox and add new homes to data/listings.json.

Picks up any Rightmove, Zoopla, OnTheMarket or OpenRent listing link in any email
(portal alerts, or a listing someone forwarded), so it doesn't depend on one email layout.

Env: GMAIL_ADDRESS, GMAIL_APP_PASSWORD. Optional: LOOKBACK_DAYS (default 7), DRY_RUN=1.
Exits 1 if a portal alert email contained no listing we could read, so the Action fails loudly
(once: every email read is recorded in data/processed_emails.json, except ones whose tracking
links couldn't be followed, which are retried next run).
"""
import datetime as dt
import email
import html
import imaplib
import json
import os
import re
import sys
import urllib.error
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
# Portal newsletters and offers (news@email.zoopla.co.uk, info@email.onthemarket.com): never listings.
MARKETING = re.compile(r"\b(news|info|marketing|offers|newsletter)@|@(email|news|marketing)\.", re.I)
TRACKING_HOST = re.compile(r"https?://[^\s\"'<>)]*(?:rightmove|zoopla|onthemarket|openrent)[^\s\"'<>)]*", re.I)
# Links not worth following: portal pages, images, fonts, open pixels and unsubscribe links.
NO_RESOLVE = re.compile(r"//(www|media|static\w*|images\w*|st|advantage|go\.advantage|tracking)\.|"
                        r"\.(png|jpe?g|gif|svg|woff2?|ttf|css)\b|unsubscribe|/wf/open|alert-opened", re.I)
MIN_RENT, MAX_RENT, MIN_BEDS = 3000, 5000, 4
EXCLUDED_AREAS = re.compile(r"isleworth|osterley|new malden|hounslow|twickenham|whitton|brixton|streatham|\b(TW\d{1,2}|KT3|SW2|SW16|SE\d{1,2}|W3|W1[01])\b", re.I)


def decoded(value):
    return str(make_header(decode_header(value or "")))


def body_text(msg):
    """Return (html_or_text, plain_text) for the whole message: the HTML parts if any, else the plain ones."""
    parts = {"text/html": [], "text/plain": []}
    for part in msg.walk():
        if part.get_content_type() in parts and not part.get_filename():
            payload = part.get_payload(decode=True) or b""
            parts[part.get_content_type()].append(payload.decode(part.get_content_charset() or "utf-8", errors="replace"))
    raw = "\n".join(parts["text/html"] or parts["text/plain"])
    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", raw, flags=re.S | re.I)
    text = re.sub(r"<br\s*/?>|</(p|div|tr|td|li|h\d)>", "\n", text, flags=re.I)
    text = html.unescape(re.sub(r"<[^>]+>", " ", text))
    text = re.sub(r"[ \t\xa0]+", " ", text)
    return raw, text


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


def resolve(url):
    """Where a tracking link points: its first redirect's Location (the target isn't fetched).

    Returns None when that can't be read (blocked, rate-limited, offline), so the caller can retry later.
    """
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.build_opener(_NoRedirect).open(req, timeout=10) as r:
            return r.geturl()
    except urllib.error.HTTPError as e:
        return e.headers.get("Location") or (e.url if e.code < 400 else None)
    except Exception:
        return None


def portal_hits(url):
    return [(p, m) for p, rx, _ in PORTALS for m in [rx.search(url or "")] if m]


def find_listings(raw, unresolved=None):
    """Return {(portal, id): position_in_raw} for every listing link.

    Tracking links are only followed when the email has no plain listing link (portal alerts do);
    any that can't be read are added to `unresolved`.
    """
    found = {}
    candidates = [(m.start(), html.unescape(m.group(0))) for m in TRACKING_HOST.finditer(raw)]
    for pos, url in candidates:
        for p, m in portal_hits(url):
            found.setdefault((p, m.group(1)), pos)
    if found:
        return found
    seen = {}
    for pos, url in candidates:
        if NO_RESOLVE.search(url) or len(seen) >= 60:
            continue
        if url not in seen:
            seen[url] = resolve(url)
            if seen[url] is None and unresolved is not None:
                unresolved.append(url)
        for p, m in portal_hits(seen[url]):
            found.setdefault((p, m.group(1)), pos)
    return found


# "£4,999 pcm", "£950 pw", "£1,084.62" (Zoopla shows some weekly prices with no unit)
PRICE = re.compile(r"£\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d\d)?\s*(pcm|per month|p/?w|per week|/month|/week|a month|a week)?", re.I)
NOT_RENT = re.compile(r"(reduced by|reduced from|was|deposit( of)?:?)\s*$", re.I)  # price cuts: keep the new price
WORD_NUMS = {w: str(i) for i, w in enumerate("one two three four five six seven eight".split(), 1)}
BEDS = re.compile(r"\b(\d+|" + "|".join(WORD_NUMS) + r")[\s-]*bed(?:room)?s?\b", re.I)  # "4 bed", "4-bedroom", "Four bedroom"; not "10 Bedford Road"
POSTCODE = r"(?:SW|SE|NW|KT|TW|CR|SM|W)\d{1,2}\b"
ADDRESS = re.compile(r"[^<>\n|]{0,80}\b(?:" + POSTCODE + r"|London|Road|Street|Avenue|Lane|Gardens|Close|Way|Grove|Place|"
                     r"Crescent|Terrace|Mews|Drive|Square)[^<>\n|]{0,40}")
OPENRENT = re.compile(r"(\d+) Bed ([^,\n]+), (.+?) - £([\d,]+)", re.I)  # "5 Bed Terraced House, Claybrook Road, W6 - £4,800": title "Claybrook Road, W6"


def visible(fragment):
    """An HTML fragment as plain lines, without tags or URLs."""
    t = re.sub(r"^[^<]*?>|<[^>]*$", "", fragment) if "<" in fragment else fragment  # tags cut by the window
    t = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", t, flags=re.S | re.I)
    t = re.sub(r"<(?:br|/p|/div|/tr|/td|/li|/h\d)[^>]*>", "\n", t, flags=re.I)
    t = html.unescape(re.sub(r"<[^>]+>", " ", t))
    t = re.sub(r"\(?\s*(https?://|mailto:|tel:)\S*\s*\)?", " ", t)
    return re.sub(r"[ \t\r\xa0]+", " ", t)


def details_near(raw, pos, next_pos, prev_pos=None):
    """Pull price, beds and an address from the email around one listing's link.

    Reads the text between the neighbouring listing links (at most 600 visible chars after the link,
    300 before) and takes the match closest to this link, so one listing never borrows another's price.
    """
    after = visible(raw[pos:next_pos or len(raw)][:30000])[:600]
    before = visible(raw[max(prev_pos or 0, pos - 30000):pos])[-300:]

    def closest(rx, ok=lambda t, m: True):
        # Alert layouts put details after the link; fall back to the nearest one before it.
        for m in rx.finditer(after):
            if ok(after, m):
                return m
        ms = [m for m in rx.finditer(before) if ok(before, m)]
        return ms[-1] if ms else None

    m = OPENRENT.search(after)
    if m:
        return int(m.group(4).replace(",", "")), int(m.group(1)), m.group(3).strip()
    rent = None
    m = closest(PRICE, lambda t, m: not NOT_RENT.search(t[max(0, m.start() - 20):m.start()]))
    if m:
        rent = int(m.group(1).replace(",", ""))
        unit = (m.group(3) or "").lower()
        if "w" in unit or (not unit and rent < 1500):
            rent = round((rent + float(m.group(2) or 0)) * 52 / 12)
    m = closest(BEDS)
    beds = int(WORD_NUMS.get(m.group(1).lower(), m.group(1))) if m else None
    m = closest(ADDRESS, lambda t, m: not re.search(r"copyright|registered|mailing address|search", m.group(0), re.I))
    title = re.sub(r"\s+", " ", m.group(0)) if m else ""
    title = re.sub(r"^.*?\bto (rent|let)\b\s*[-–—]?\s*", "", title, flags=re.I)  # "£3,500 pcm 4 bedroom house to rent - "
    title = re.split(r"\s+Marketed by\b", title, flags=re.I)[0].strip(" ,-")
    title = re.sub(r"^[a-z]{2,6}\d{5,},\s*", "", title)  # Zoopla agent refs: "chpk0457673, Cornford Grove"
    return rent, beds, title


def area_from(title):
    for a in ("Putney", "Southfields", "Earlsfield", "Wandsworth", "Tooting", "Balham", "Wimbledon",
              "Raynes Park", "Clapham", "Roehampton", "New Malden", "Colliers Wood", "Fulham", "Hammersmith",
              "Chiswick", "Shepherd's Bush", "Shepherds Bush", "Battersea"):
        if a.lower() in title.lower():
            return a
    m = re.search(r"\b(SW\d{1,2}|SE\d{1,2}|NW\d{1,2}|W\d{1,2}|KT\d{1,2}|TW\d{1,2}|CR\d|SM\d)\b", title)
    return m.group(1) if m else ""


STREET = re.compile(r"(?<=\w )(st)\b|\b(rd|road|street|avenue|lane|gardens|close|way|grove|place|mews|row|crescent|hill|drive|terrace|"
                    r"square|walk|court|park|rise|vale|green|parade|yard|wharf|house|common|villas|path|mansions)\b", re.I)
MONTHS = {m: i + 1 for i, m in enumerate("jan feb mar apr may jun jul aug sep oct nov dec".split())}


def street(title):
    """The street in a title, lower case, or "" if there isn't one.

    'Mascotte Road, London, SW15' -> 'mascotte road'; '8 Bucharest Road Battersea' -> 'bucharest road';
    'Firstway, London' -> 'firstway'; 'Raynes Park, London' -> ''; '5 Bed Terraced House, Claybrook Road, W6' ->
    'claybrook road'; 'Fairway London SW20' -> 'fairway'.
    """
    title = re.sub(r"^\s*\d+\s+bed(room)?s?\b.*?\bto (rent|let)\s*[-–—]\s*", "", title or "", flags=re.I)  # OnTheMarket
    title = re.sub(r"^.*\bsq\.? ?ft\s+", "", title, flags=re.I)  # "1 reception1381 sq ft Sefton Street"
    parts = [re.sub(r"\s+", " ", p).strip() for p in re.split(r",|\.\s+(?=[A-Z]{1,2}\d)|\s+[-–—�]\s+", title)]
    # Skip "5 Bed Terraced House" and agent refs like "chpk0457673"
    first = next((p for p in parts if not re.search(r"\bbed(room)?s?\b|^[a-z]{2,6}\d{5,}$", p, re.I)), "")
    m = ([None] + list(STREET.finditer(first)))[-1]  # last one: "St Ann's Park Road" ends at Road
    if m and not re.fullmatch(r"(raynes|colliers|putney|wimbledon|clapham)\s+\w+", first[:m.end()], re.I):
        s = re.sub(r"^\d+\s+", "", first[:m.end()]).lower()
        return re.sub(r" rd$", " road", re.sub(r" st$", " street", s))
    if re.search(r"\w(way|heath|view|side)$", first, re.I):
        return first.lower()
    m = re.search(r"\b(\w+(?:way|heath|view|side))\b", first, re.I)  # no comma: "Fairway London SW20"
    return m.group(1).lower() if m else ""


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
    counts. A second advert on a portal the home is already on counts as a different home (streets often
    have several similar homes at one price) unless one of the home's adverts is down: then it's a relist.
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
        other = street(r.get("title"))
        if hosts & theirs & PORTAL_SITES:
            # Except a relist: one of the home's adverts has come down, and this one has the same
            # street, beds and rent (within £50).
            return bool(r.get("off_market") and s and s == other and beds and beds == r.get("beds")
                        and abs(r["rent"] - rent) <= 50)
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


def new_price(home, rent, beds, when, site):
    """A price change in an email about an advert we already have. True when the home's price changed.

    Only a newer price on the same site, within 25% of the last one, for a live home whose beds match:
    a misread card shouldn't move a known home's rent. With no earlier price from that site (the sweep
    records only its main link's site), it's compared with the home's current rent.
    """
    if not rent or home.get("status") == "gone" or (beds and home.get("beds") and beds != home["beds"]):
        return False
    same = [p for p in home.get("prices") or [] if p[2] == site]
    last = same[-1] if same else (["", home["rent"], site] if home.get("rent") else None)
    if not last or last[1] == rent or (last[0] or "") > when or abs(rent - last[1]) > 0.25 * last[1]:
        return False
    if not same:
        home.setdefault("prices", []).append(last)  # so the history shows what it was cut from
    record_price(home, rent, when, site)
    cut = "cut" if rent < last[1] else "rise"
    home.setdefault("notes", []).append(f"Price {cut} on {site.title()}: £{last[1]:,} to £{rent:,} ({when}).")
    # the shown rent is the lowest of each site's latest price, as in merge_price
    latest = {s: r for _, r, s in home["prices"] if s and s != "search"}
    home["rent"] = min(latest.values())
    return True


def read_email(msg, listings, known, added, failures, today):
    """Add the new homes in one email to `listings`. False when it should be read again next run."""
    sender, subject = decoded(msg.get("From")).lower(), decoded(msg.get("Subject"))
    if MARKETING.search(sender):
        return True
    raw, _ = body_text(msg)
    unresolved = []
    found = find_listings(raw, unresolved)
    alert = any(s in sender for s in PORTAL_SENDERS) and "alert" in sender
    if unresolved:
        print(f"  ? {len(unresolved)} tracking links unreadable, retrying next run: {sender} | {subject}")
    elif not found and alert:
        failures.append(f"{sender} | {subject}")
    positions = sorted(found.values())
    try:
        sent = parsedate_to_datetime(msg["Date"]).astimezone(dt.timezone.utc)
        when, at = sent.date().isoformat(), sent.strftime("%Y-%m-%dT%H:%MZ")
    except Exception:
        when, at = today, dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    unread = cards = 0
    for (portal, pid), pos in found.items():
        nxt = next((p for p in positions if p > pos), None)
        prv = max((p for p in positions if p < pos), default=None)
        if (portal, pid) in known:
            home = known[(portal, pid)]
            rent, beds, _ = details_near(raw, pos, nxt, prv) if home else (None, None, "")
            if home and new_price(home, rent, beds, when, portal):
                added.append(f"{portal}-{pid} price now £{rent:,} on {home['id']}")
            continue
        rent, beds, title = details_near(raw, pos, nxt, prv)
        cards += 1
        if not rent and not beds:  # a link in a forward or footer, not a listing card
            unread += 1
            continue
        if rent and not (MIN_RENT <= rent <= MAX_RENT):
            continue
        if beds and beds < MIN_BEDS:
            continue
        if EXCLUDED_AREAS.search(title):
            continue
        url = dict((p, t) for p, _, t in PORTALS)[portal].format(pid)
        dup = same_home(listings, title, rent, beds, None, [url])
        if dup:
            dup.setdefault("links", []).append(url)
            merge_price(dup, rent, f"{portal.title()} email {when}", when, portal)
            known[(portal, pid)] = dup
            added.append(f"{portal}-{pid} linked to existing {dup['id']}")
            continue
        listings.append({
            "id": f"{portal}-{pid}", "title": title or f"{portal.title()} listing {pid}", "area": area_from(title),
            "rent": rent, "beds": beds, "baths": None, "available": "", "sharers": "unknown", "status": "new",
            "url": url, "links": [url], "source": "alert", "added": when, "added_at": at,
            "notes": [f"From an email on {when}: {subject[:120]}"],
        })
        record_price(listings[-1], rent, when, portal)
        known[(portal, pid)] = listings[-1]
        added.append(f"{portal}-{pid} {title} £{rent}")
    if alert and cards and unread == cards and not unresolved:
        # listing links but no price or beds by any of them: the card layout has probably changed
        failures.append(f"{sender} | {subject} (no price or beds read)")
    return not unresolved


def main():
    if not os.environ.get("GMAIL_ADDRESS") or not os.environ.get("GMAIL_APP_PASSWORD"):
        print("Gmail secrets not set yet; skipping.")
        return
    listings = json.load(open(LISTINGS, encoding="utf-8"))
    processed = json.load(open(PROCESSED, encoding="utf-8")) if PROCESSED.exists() else []
    known = {}  # (portal, id) -> the home that advert belongs to
    for r in listings:
        for u in r.get("links", []) + [r.get("url", "")]:
            for p, rx, _ in PORTALS:
                m = rx.search(u or "")
                if m:
                    known[(p, m.group(1))] = r

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
        if read_email(msg, listings, known, added, failures, today):
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

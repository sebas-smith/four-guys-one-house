"""Offline checks for the email parser. Run: python scripts/test_ingest.py"""
import email
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import ingest_alerts as ia  # noqa: E402

SAMPLE = """From: Rightmove <alerts@rightmove.co.uk>
Subject: 2 new properties match your search
Content-Type: text/html; charset=utf-8

<table>
<tr><td><a href="https://www.rightmove.co.uk/properties/171234567?utm_source=alert">View</a></td>
<td>Elsenham Street, Southfields, London SW18</td><td>&pound;4,200 pcm</td><td>4 bedroom terraced house</td></tr>
<tr><td><a href="https://www.rightmove.co.uk/properties/171234999#/?channel=RES_LET">View</a></td>
<td>Tiny Road, Balham SW12</td><td>&pound;2,100 pcm</td><td>2 bedroom flat</td></tr>
</table>
Forwarded: https://www.zoopla.co.uk/to-rent/details/74512345/ Garratt Lane, Earlsfield SW18 &pound;950 pw 4 bed
"""


def sweep_links():
    """A sweep row that bundles another home's adverts, or a second Rightmove advert at another price, leaves them off."""
    import csv
    import json
    import tempfile
    import merge_sweep as ms
    home = {"id": "openrent-1", "title": "Firstway", "rent": 3800, "beds": 4, "baths": 2, "status": "new", "notes": [],
            "links": ["https://www.openrent.co.uk/1234567", "https://www.rightmove.co.uk/properties/11"]}
    other = {"id": "foxtons-1", "title": "Firstway", "rent": 4000, "beds": 4, "baths": 2, "status": "new", "notes": [],
             "links": ["https://www.onthemarket.com/details/22/"]}
    row = {"id": "openrent-1", "address_or_area": "Firstway", "area": "Raynes Park", "monthly_rent_gbp": "3800", "bedrooms": "4",
           "bathrooms": "2", "availability": "", "status": "live", "first_seen": "", "sharer_suitability": "", "checked_at": "2026-10-25",
           "listing_urls": "https://www.openrent.co.uk/1234567|https://www.onthemarket.com/details/22/|https://www.kfh.co.uk/x-52503/"}
    with tempfile.TemporaryDirectory() as d:
        ms.LISTINGS = Path(d) / "listings.json"
        src = Path(d) / "sweep.csv"

        def run(rows, homes):
            json.dump(homes, open(ms.LISTINGS, "w", encoding="utf-8"))
            with open(src, "w", newline="", encoding="utf-8") as f:
                w = csv.DictWriter(f, fieldnames=list(rows[0]))
                w.writeheader()
                w.writerows(rows)
            ms.main(src, False, path=ms.LISTINGS)  # never the real data/listings.json
            return {r["id"]: r for r in json.load(open(ms.LISTINGS, encoding="utf-8"))}

        out = run([row], [home, other])
        assert out["openrent-1"]["links"] == home["links"] + ["https://www.kfh.co.uk/x-52503/"], out["openrent-1"]["links"]
        assert out["foxtons-1"]["links"] == other["links"]
        relist = dict(row, listing_urls="https://www.openrent.co.uk/1234567|https://www.rightmove.co.uk/properties/12")
        assert "https://www.rightmove.co.uk/properties/12" in run([relist], [home])["openrent-1"]["links"]
        cheaper = dict(relist, monthly_rent_gbp="3500")
        assert "https://www.rightmove.co.uk/properties/12" not in run([cheaper], [home])["openrent-1"]["links"]


EMAILS = Path(__file__).resolve().parent.parent / "tests" / "emails"
# Real emails from the bot inbox, 27 Oct 2026: (portal id, rent, beds, title)
EXPECTED = {
    "openrent_hammersmith": [("openrent", "3088555", 4800, 5, "Claybrook Road, W6")],
    "zoopla_price_reduced": [("zoopla", "74524542", 4999, 4, "Gaskarth Road, London SW12"),
                             ("zoopla", "74510179", 4500, 4, "Prothero Road, Fulham SW6"),
                             ("zoopla", "74424488", 4000, 4, "Tremadoc Road, Clapham SW4"),
                             ("zoopla", "74416902", 4000, 4, "Brayburne Avenue, London SW4"),
                             ("zoopla", "74314978", 4500, 4, "Overstone Road, Hammersmith W6")],
    "zoopla_new": [("zoopla", "74612934", 4147, 4, "Ivy Crescent, Chiswick W4"),
                   ("zoopla", "74609220", 4700, 4, "Cornford Grove, Balham, SW12"),  # weekly price only: £1,084.62
                   ("zoopla", "70603417", 4500, 4, "Bloemfontein Avenue W12"),
                   ("zoopla", "74604845", 3750, 5, "Fairway, London SW20")],
    "rightmove": [("rightmove", "94757757", 3450, 4, "Arcadian Place, London, SW18"),
                  ("rightmove", "94760382", 4700, 4, "Cornford Grove, Balham, London, SW12")],
    "onthemarket_new": [("onthemarket", "19039243", 3500, 4, "Hebdon Road, Tooting Bec, London, SW17")],
    "onthemarket_reduced": [("onthemarket", "20408114", 4750, 4, "St. Ann's Park Road London SW18")],
}


def load(name):
    return email.message_from_binary_file(open(EMAILS / f"{name}.eml", "rb"))


def fixtures():
    """Parse the saved alert emails offline; newsletters add nothing and don't count as failures."""
    ia.resolve = lambda url: None  # never touch the network
    for name, want in EXPECTED.items():
        raw, _ = ia.body_text(load(name))
        found = ia.find_listings(raw)
        pos = sorted(found.values())
        for portal, pid, rent, beds, title in want:
            p = found[(portal, pid)]
            got = ia.details_near(raw, p, next((q for q in pos if q > p), None), max((q for q in pos if q < p), default=None))
            assert got == (rent, beds, title), (name, pid, got)
        if name == "zoopla_new":
            assert len(found) == 10, found
    for name in EXPECTED:
        listings, added, failures = [], [], []
        assert ia.read_email(load(name), listings, set(), added, failures, "2026-10-27") and not failures, (name, failures)
        assert listings and all(h["rent"] and h["beds"] and h["area"] for h in listings), (name, listings)
    for name in ("newsletter_zoopla", "newsletter_onthemarket"):
        listings, added, failures = [], [], []
        assert ia.read_email(load(name), listings, set(), added, failures, "2026-10-27"), name
        assert not listings and not failures, (name, listings, failures)
    # An alert with nothing readable is reported, and still marked read so it's reported once.
    blank = email.message_from_string("From: Rightmove <property@alert.rightmove.co.uk>\nSubject: 2 new homes\n\nnothing")
    failures = []
    assert ia.read_email(blank, [], set(), [], failures, "2026-10-27") and failures
    # A tracking link that can't be followed (403/429) leaves the email unread so it's retried.
    tracked = email.message_from_string("From: Sam <sam@example.com>\nSubject: look\n\nhttps://clicks.rightmove.co.uk/f/a/xyz")
    assert not ia.read_email(tracked, [], set(), [], [], "2026-10-27")
    ia.resolve = lambda url: "https://www.rightmove.co.uk/properties/94757757#/?channel=RES_LET"
    assert ("rightmove", "94757757") in ia.find_listings("https://clicks.rightmove.co.uk/f/a/xyz")
    # A forwarded link with no price or beds near it isn't a new home.
    fwd = email.message_from_string("From: Sam <sam@example.com>\nSubject: this one?\n\nhttps://www.zoopla.co.uk/to-rent/details/70000001/")
    listings = []
    assert ia.read_email(fwd, listings, set(), [], [], "2026-10-27") and not listings
    # OpenRent's plain-text part, read on its own.
    plain = next(p for p in load("openrent_hammersmith").walk() if p.get_content_type() == "text/plain")
    text = plain.get_payload(decode=True).decode(plain.get_content_charset() or "utf-8")
    found = ia.find_listings(text)
    assert ia.details_near(text, found[("openrent", "3088555")], None) == (4800, 5, "Claybrook Road, W6")


def main():
    msg = email.message_from_string(SAMPLE)
    raw, _ = ia.body_text(msg)
    found = ia.find_listings(raw)
    assert ("rightmove", "171234567") in found, found
    assert ("rightmove", "171234999") in found, found
    assert ("zoopla", "74512345") in found, found
    pos = sorted(found.values())
    rent, beds, title = ia.details_near(raw, found[("rightmove", "171234567")], pos[1])
    assert (rent, beds) == (4200, 4), (rent, beds, title)
    assert "Elsenham" in title, title
    rent, beds, title = ia.details_near(raw, found[("rightmove", "171234999")], pos[2], pos[0])
    assert (rent, beds) == (2100, 2) and "Tiny" in title, (rent, beds, title)
    rent, beds, _ = ia.details_near(raw, found[("zoopla", "74512345")], None, pos[1])
    assert rent == round(950 * 52 / 12) and beds == 4, (rent, beds)
    raw = "https://www.rightmove.co.uk/properties/94388301 Mascotte Road, London, SW15 £3,748 pcm 4 bedroom"
    rent, beds, title = ia.details_near(raw, 0, None)
    assert title.startswith("Mascotte Road") and (rent, beds) == (3748, 4), (rent, beds, title)
    existing = [{"id": "onthemarket-1", "title": "Mascotte Road, London, SW15", "rent": 3748}]
    assert ia.same_home(existing, "Mascotte Road, Putney SW15", 3750) is existing[0]
    assert ia.same_home(existing, "Mascotte Road, Putney SW15", 4200) is None
    assert ia.same_home(existing, "London SW15", 3748) is None
    cut = [{"id": "rightmove-1", "title": "Carlton Drive, \nPutney Hill, SW15", "rent": 4000, "beds": 4, "baths": 2, "links": ["https://www.rightmove.co.uk/y"]}]
    assert ia.same_home(cut, "Carlton Drive, Putney Hill SW15", 3850, 4, 2, ["https://www.zoopla.co.uk/x"]) is cut[0]
    assert ia.same_home(cut, "Carlton Drive, Putney Hill SW15", 3850, 4, 3, ["https://www.zoopla.co.uk/x"]) is None
    assert ia.same_home(cut, "Carlton Drive, Putney Hill SW15", 3850) is None
    for t, want in [("Firstway, London, SW20", "firstway"), ("8 Bucharest Road Battersea, SW18", "bucharest road"),
                    ("Raynes Park, London", ""), ("Farnham Gardens – London Property Guru advert", "farnham gardens"),
                    ("Chasefield Rd, London SW17", "chasefield road"), ("St. Ann's Park Road", "st. ann's park road"),
                    ("5 Bed Terraced House, Claybrook Road, W6", "claybrook road"), ("Fairway London SW20", "fairway"),
                    ("chpk0457673, Cornford Grove, Balham, SW12", "cornford grove")]:
        assert ia.street(t) == want, (t, ia.street(t))
    for t, want in [("Availability date: 24 Oct 2026", "2026-10-24"), ("24/10/2026", "2026-10-24"),
                    ("24 October 2026", "2026-10-24"), ("Available now", None)]:
        assert ia.avail_date(t) == want, (t, ia.avail_date(t))
    fairway = [{"title": "Fairway, London SW20", "rent": 3750, "beds": 5, "baths": 2, "available": "24/10/2026"}]
    assert ia.same_home(fairway, "Raynes Park, London", 3750, 5, 2, (), "Availability date: 24 Oct 2026") is fairway[0]
    assert ia.same_home(fairway, "Raynes Park, London", 3750, 5, 2, (), "1 Nov 2026") is None
    # Several similar homes on one street: a second advert on a portal the home is already on is another home.
    rm = [{"id": "rightmove-1", "title": "Firstway, London SW20", "rent": 4000, "beds": 4, "baths": 2, "links": ["https://www.rightmove.co.uk/properties/1"]}]
    assert ia.same_home(rm, "Firstway, SW20", 4000, 4, 2, ["https://www.rightmove.co.uk/properties/2"]) is None
    assert ia.same_home(rm, "Firstway, SW20", 4000, 4, 2, ["https://www.zoopla.co.uk/to-rent/details/2/", "https://www.rightmove.co.uk/properties/2"]) is None
    assert ia.same_home(rm, "Firstway, SW20", 3980, 4, 2, ["https://www.zoopla.co.uk/to-rent/details/2/"]) is rm[0]
    bucharest = [{"title": "Bucharest Road, Battersea", "rent": 4995, "beds": 5, "baths": 2, "links": ["https://www.dexters.co.uk/x"]}]
    assert ia.same_home(bucharest, "Bucharest Road, London, SW18", 5000, 5, 3, ["https://www.onthemarket.com/details/3/"]) is None
    # The 8% price-cut rule is for portals lagging each other, not an agent's own site against a portal.
    jacksons = [{"title": "Squarey Street", "rent": 4250, "beds": 4, "baths": 2, "links": ["https://www.jacksonsestateagents.com/properties/1/lettings"]}]
    assert ia.same_home(jacksons, "Squarey Street, Earlsfield", 4500, 4, 2, ["https://www.zoopla.co.uk/to-rent/details/4/"]) is None
    sweep_links()
    ia.merge_price(cut[0], 3850, "test")
    assert cut[0]["rent"] == 3850 and "£4,000 vs £3,850" in cut[0]["notes"][0], cut[0]
    for t, want in [("£4,999 pcm (£1,153.62 pw) Reduced by £138.69 pw", 4999), ("Reduced by £138.69 pw £4,500 pcm", 4500),
                    ("£12,500 pcm", 12500), ("£1,084.62", 4700), ("£950 pw", 4117)]:
        assert ia.details_near("https://www.zoopla.co.uk/to-rent/details/1/ " + t, 0, None)[0] == want, (t, ia.details_near(t, 0, None))
    assert ia.area_from("Wendell Road, London W12") == "W12" and ia.area_from("Overstone Road, W6") == "W6"
    fixtures()
    import check_live as cl
    pad = " " * 6000  # real advert pages; short bodies count as blocked
    otm = "https://www.onthemarket.com/details/8848009/"
    assert cl.verdict(otm, 200, otm, pad + '{"labelText":"Let agreed"}') == "let"
    assert cl.verdict(otm, 200, otm, pad + '{"labelText":"Reduced"}') == "live"
    rm = "https://www.rightmove.co.uk/properties/90369216"
    assert cl.verdict(rm, 200, rm, pad + '<span class="ksc_lozenge">LET AGREED</span>') == "let"
    assert cl.verdict(rm, 200, rm, pad + 'href="?includeLetAgreed=true"') == "live"
    assert cl.verdict(rm, 410, rm, "") == "removed"
    zp = "https://www.zoopla.co.uk/to-rent/details/74268053/"
    assert cl.verdict(zp, 200, "https://www.zoopla.co.uk/to-rent/property/london/longmead-road/", pad) == "removed"
    assert cl.verdict(zp, 200, zp, pad + '\\"listingStatus\\":\\"to_rent\\"') == "live"
    assert cl.verdict("https://www.jacksonsestateagents.com/properties/1/lettings", 403, "", "") is None
    assert cl.verdict(otm, 200, otm, "<title>Just a moment...</title>" + pad) is None
    assert cl.verdict(otm, 200, otm, '{"labelText":"Let agreed"}') is None  # too short to be the advert
    print("ok")


if __name__ == "__main__":
    main()

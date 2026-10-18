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
                    ("Chasefield Rd, London SW17", "chasefield road"), ("St. Ann's Park Road", "st. ann's park road")]:
        assert ia.street(t) == want, (t, ia.street(t))
    for t, want in [("Availability date: 24 Oct 2026", "2026-10-24"), ("24/10/2026", "2026-10-24"),
                    ("24 October 2026", "2026-10-24"), ("Available now", None)]:
        assert ia.avail_date(t) == want, (t, ia.avail_date(t))
    fairway = [{"title": "Fairway, London SW20", "rent": 3750, "beds": 5, "baths": 2, "available": "24/10/2026"}]
    assert ia.same_home(fairway, "Raynes Park, London", 3750, 5, 2, (), "Availability date: 24 Oct 2026") is fairway[0]
    assert ia.same_home(fairway, "Raynes Park, London", 3750, 5, 2, (), "1 Nov 2026") is None
    ia.merge_price(cut[0], 3850, "test")
    assert cut[0]["rent"] == 3850 and "£4,000 vs £3,850" in cut[0]["notes"][0], cut[0]
    import check_live as cl
    otm = "https://www.onthemarket.com/details/8848009/"
    assert cl.verdict(otm, 200, otm, '{"labelText":"Let agreed"}') == "let"
    assert cl.verdict(otm, 200, otm, '{"labelText":"Reduced"}') == "live"
    rm = "https://www.rightmove.co.uk/properties/90369216"
    assert cl.verdict(rm, 200, rm, '<span class="ksc_lozenge">LET AGREED</span>') == "let"
    assert cl.verdict(rm, 200, rm, 'href="?includeLetAgreed=true"') == "live"
    assert cl.verdict(rm, 410, rm, "") == "removed"
    zp = "https://www.zoopla.co.uk/to-rent/details/74268053/"
    assert cl.verdict(zp, 200, "https://www.zoopla.co.uk/to-rent/property/london/longmead-road/", "") == "removed"
    assert cl.verdict(zp, 200, zp, '\\"listingStatus\\":\\"to_rent\\"') == "live"
    assert cl.verdict("https://www.jacksonsestateagents.com/properties/1/lettings", 403, "", "") is None
    print("ok")


if __name__ == "__main__":
    main()

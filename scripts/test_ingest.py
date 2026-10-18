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
    print("ok")


if __name__ == "__main__":
    main()

"""Print the portal search links for the drawn search area.

The same shape is saved as an instant alert on Rightmove, Zoopla and OnTheMarket. To change the
area, edit POINTS, run this, open each link signed in as the bot and save a new alert from it.
"""
import json
from urllib.parse import quote, urlencode

# (lat, lng), clockwise from Putney riverside: Chiswick (to Strand-on-the-Green and Bedford Park),
# East Acton, Shepherd's Bush, Hammersmith, Fulham, Battersea (to the river), Clapham, Balham,
# Earls Court and West Brompton (to Warwick Road), Tooting, Earlsfield, Southfields, Roehampton.
# Stops short of Brentford (TW8), Acton (W3), Brixton, Gloucester Road and Wimbledon.
POINTS = [
    (51.4660, -0.2280), (51.4850, -0.2300), (51.4870, -0.2450), (51.4790, -0.2560),
    (51.4820, -0.2700), (51.4850, -0.2800), (51.4885, -0.2865), (51.4950, -0.2800),
    (51.5010, -0.2700), (51.5080, -0.2560), (51.5150, -0.2530), (51.5195, -0.2450),
    (51.5195, -0.2300), (51.5160, -0.2180), (51.5080, -0.2050), (51.5000, -0.2030),
    (51.4965, -0.1920), (51.4935, -0.1840), (51.4850, -0.1820), (51.4800, -0.1780), (51.4815, -0.1680),
    (51.4830, -0.1550), (51.4840, -0.1430), (51.4760, -0.1370),
    (51.4700, -0.1300), (51.4630, -0.1250), (51.4520, -0.1300),
    (51.4450, -0.1350), (51.4350, -0.1400), (51.4200, -0.1500),
    (51.4150, -0.1650), (51.4160, -0.1750), (51.4310, -0.1750), (51.4320, -0.1930),
    (51.4400, -0.1930), (51.4400, -0.2150),
    (51.4430, -0.2500), (51.4550, -0.2550), (51.4650, -0.2450),
]
# Nothing south of Earlsfield except Tooting and Balham (Seb, 11 Nov): Wimbledon, Wimbledon Park, Raynes
# Park, Colliers Wood and south Southfields are out, whichever alert or sweep finds them.


def south_out(loc):
    """True for a position south of Earlsfield that isn't Tooting or Balham.

    Out: south of Tooting station (51.415); west of Tooting (-0.175: Colliers Wood, Haydons Road, South
    Wimbledon) below Earlsfield's southern streets (51.431, Squarey Street and Deeside Road stay); and
    Wimbledon Park and south Southfields (west of -0.193, below 51.440)."""
    lat, lng = loc
    return lat < 51.4150 or (lat < 51.4310 and lng < -0.1750) or (lat < 51.4400 and lng < -0.1930)


def encode(points):
    """Google encoded polyline."""
    out, prev_lat, prev_lng = "", 0, 0
    for lat, lng in points:
        lat, lng = round(lat * 1e5), round(lng * 1e5)
        for v in (lat - prev_lat, lng - prev_lng):
            v = ~(v << 1) if v < 0 else v << 1
            while v >= 0x20:
                out += chr((0x20 | (v & 0x1F)) + 63)
                v >>= 5
            out += chr(v + 63)
        prev_lat, prev_lng = lat, lng
    return out


def inside(lat, lng):
    """True when the point is inside the drawn area."""
    found = False
    for (y1, x1), (y2, x2) in zip(POINTS, POINTS[-1:] + POINTS[:-1]):
        if (y1 > lat) != (y2 > lat) and lng < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
            found = not found
    return found


if __name__ == "__main__":
    open_shape = encode(POINTS)
    closed_shape = encode(POINTS + POINTS[:1])

    print("Rightmove (then Map view > Save area > Create alert):")
    print("https://www.rightmove.co.uk/property-to-rent/find.html?" + urlencode({
        "locationIdentifier": "USERDEFINEDAREA^" + json.dumps({"polylines": closed_shape}, separators=(",", ":")),
        "minBedrooms": 4, "minPrice": 3000, "maxPrice": 5000, "includeLetAgreed": "false"}))
    print("\nZoopla (Save > Instantly); the shape is URL-encoded twice:")
    print("https://www.zoopla.co.uk/to-rent/map/property/putney/?beds_min=4&price_frequency=per_month"
          "&price_min=3000&price_max=5000&q=Putney&search_source=to-rent&polyenc="
          + quote(quote(open_shape, safe=""), safe=""))
    print("\nOnTheMarket (Create alert):")
    print("https://www.onthemarket.com/to-rent/property/london/?min-bedrooms=4&min-price=3000"
          "&max-price=5000&view=map-list&polygons=" + quote(closed_shape, safe=""))

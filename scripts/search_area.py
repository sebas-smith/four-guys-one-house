"""Print the portal search links for the drawn search area.

The same shape is saved as an instant alert on Rightmove, Zoopla and OnTheMarket. To change the
area, edit POINTS, run this, open each link signed in as the bot and save a new alert from it.
"""
import json
from urllib.parse import quote, urlencode

# (lat, lng), clockwise from Putney riverside: Chiswick, Shepherd's Bush, Hammersmith, Fulham,
# Wandsworth, Battersea, Clapham, Balham, Tooting, Wimbledon, Raynes Park, Roehampton. Stops short
# of Brentford (TW8), Acton, Brixton and New Malden (KT3).
POINTS = [
    (51.4660, -0.2280), (51.4850, -0.2300), (51.4870, -0.2450), (51.4790, -0.2560),
    (51.4850, -0.2720), (51.4920, -0.2780), (51.4980, -0.2700), (51.5040, -0.2500),
    (51.5130, -0.2300), (51.5130, -0.2200), (51.5080, -0.2050), (51.4980, -0.2050),
    (51.4960, -0.2000), (51.4850, -0.1850), (51.4720, -0.1800), (51.4700, -0.1650),
    (51.4720, -0.1450), (51.4700, -0.1300), (51.4630, -0.1250), (51.4520, -0.1300),
    (51.4450, -0.1350), (51.4350, -0.1400), (51.4200, -0.1500),
    (51.4150, -0.1650), (51.4050, -0.1950), (51.4000, -0.2200), (51.4000, -0.2450),
    (51.4150, -0.2500), (51.4350, -0.2500), (51.4550, -0.2550), (51.4650, -0.2450),
]


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

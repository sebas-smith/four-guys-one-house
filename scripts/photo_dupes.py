"""Merge homes that are one house listed twice, by comparing their advert photos.

Usage: python scripts/photo_dupes.py [--dry-run] [--file listings.json]

ingest_alerts.same_home won't join two adverts on the same portal (a street often has several similar
homes at one price), so an agent's relist under a new advert number, or a second agent's advert,
arrives as a new home. This finds live pairs that could be one house: same beds (or one unknown), rent
within 8%, and the same street or positions within 250 m. Then it reads each advert's gallery
(Rightmove, OnTheMarket, Zoopla, OpenRent, Foxtons, or the page's og:image elsewhere) and compares
photos by difference hash, so a resized or recompressed copy of the same photo still matches.

- 3+ photos in common, or 2 when the smaller gallery has 4 or fewer: the same house, merged into the
  home added first (dedupe.absorb).
- Both galleries have 4+ photos and at most 1 in common (a shared street or building shot): different
  houses, recorded in both homes' `not_same` so they're never compared or merged again.
- Otherwise (galleries unreadable, e.g. Zoopla blocking GitHub): left alone and tried again next run.

Hashes are cached per advert in data/photos.json, so each gallery is downloaded once.
"""
import datetime as dt
import io
import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from check_live import blocked, fetch, site_of  # noqa: E402
from dedupe import absorb, apart  # noqa: E402
from ingest_alerts import LISTINGS, street  # noqa: E402
from stations import metres  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "photos.json"
MAX_PHOTOS = 12
NEAR_BITS = 8      # two 64-bit hashes this close are the same photo
NEAR_METRES = 250
RENT_GAP = 0.08


def gallery(url, html):
    """Up to MAX_PHOTOS small photo URLs from an advert page, one per photo, in page order."""
    html = html.replace("\\u002F", "/").replace("\\/", "/")
    site = site_of(url)
    if site == "rightmove":
        found = [f"https://media.rightmove.co.uk/dir/property-photo/{a}/{b}/{c}_max_476x317.jpeg" for a, b, c in
                 re.findall(r"media\.rightmove\.co\.uk/(?:dir/)?property-photo/(\w+)/(\d+)/(\w+?)(?:_max_\d+x\d+)?\.jpe?g", html)]
    elif site == "onthemarket":
        found = [f"https://media.onthemarket.com/properties/{p}/image-{n}-480x320.jpg" for p, n in
                 re.findall(r"media\.onthemarket\.com/properties/(\d+/\d+)/image-(\d+)-", html)]
    elif site == "zoopla":
        found = [f"https://lid.zoocdn.com/u/480/360/{h}.jpg" for h in re.findall(r"lid\.zoocdn\.com/u/\d+/\d+/(\w{40})\.jpg", html)]
    elif site == "openrent":
        found = ["https://" + p for p in re.findall(r"//(imagescdn\.openrent\.co\.uk/listings/\d+/[\w-]+\.(?:jpe?g|JPG|png))", html)]
    elif site == "foxtons":
        found = [f"https://web-prod-page-assets.foxtons.co.uk/protog/{p}/w/480/{n}.jpg" for p, n in
                 re.findall(r"web-prod-page-assets\.foxtons\.co\.uk/protog/([\w/]+?)/w/\d+/([\w-]+)\.(?:jpg|webp)", html)]
    else:
        found = []
    if not found:
        m = re.search(r'<meta[^>]+property="og:image"[^>]+content="([^"]+)"|<meta[^>]+content="([^"]+)"[^>]+property="og:image"', html)
        pic = m and (m.group(1) or m.group(2))
        if pic and pic.startswith("https://") and not re.search(r"logo|share-graphic|placeholder|default", pic, re.I):
            found = [pic]
    return list(dict.fromkeys(found))[:MAX_PHOTOS]


def dhash(data):
    """64-bit difference hash of an image: each bit says whether a pixel is brighter than its right neighbour."""
    from PIL import Image
    img = Image.open(io.BytesIO(data)).convert("L").resize((9, 8), Image.LANCZOS)
    px = list(img.getdata())
    bits = 0
    for row in range(8):
        for col in range(8):
            bits = bits << 1 | (px[row * 9 + col] > px[row * 9 + col + 1])
    return bits


def advert_hashes(url, cache):
    """Hashes of an advert's photos (hex strings), or None when the page or its photos can't be read."""
    if url in cache:
        return cache[url]["hashes"]
    code, _, html = fetch(url)
    if code != 200 or blocked(html):
        return None
    from curl_cffi import requests
    out = []
    for pic in gallery(url, html):
        try:
            r = requests.get(pic, impersonate="chrome", timeout=20)
            if r.status_code == 200:
                out.append(f"{dhash(r.content):016x}")
        except Exception:  # noqa: BLE001 - a broken image is just skipped
            pass
        time.sleep(0.2)
    if not out:
        return None
    cache[url] = {"read": dt.date.today().isoformat(), "hashes": out}
    time.sleep(0.5)
    return out


def home_hashes(home, cache):
    """Every photo hash across a home's live adverts (None when none could be read)."""
    down = set(home.get("down") or [])
    got = [advert_hashes(u, cache) for u in home.get("links") or [] if u not in down]
    got = [h for h in got if h]
    return list(dict.fromkeys(x for h in got for x in h)) if got else None


def common(a, b):
    """How many photos of a have a near-identical photo in b."""
    bs = [int(x, 16) for x in b]
    return sum(any(bin(int(x, 16) ^ y).count("1") <= NEAR_BITS for y in bs) for x in a)


def judge(a, b):
    """'same', 'different' or None for two lists of photo hashes."""
    n, small = min(common(a, b), common(b, a)), min(len(a), len(b))
    if n >= 3 or (n >= 2 and small <= 4):
        return "same"
    if small >= 4 and n <= 1:
        return "different"
    return None


def candidates(listings):
    """Pairs of live homes that could be one house, earlier-added first."""
    live = [r for r in listings if r.get("status") not in ("gone", "no") and r.get("rent")]
    live.sort(key=lambda r: (r.get("added") or "", r["id"]))
    for i, a in enumerate(live):
        for b in live[i + 1:]:
            if apart(a, b):
                continue
            if a.get("beds") and b.get("beds") and a["beds"] != b["beds"]:
                continue
            if abs(a["rent"] - b["rent"]) > RENT_GAP * max(a["rent"], b["rent"]):
                continue
            sa, sb = street(a.get("title")), street(b.get("title"))
            near = a.get("loc") and b.get("loc") and metres(a["loc"], b["loc"]) <= NEAR_METRES
            if (sa and sa == sb) or near:
                yield a, b


def main(dry, path=LISTINGS):
    listings = json.load(open(path, encoding="utf-8"))
    cache = json.load(open(CACHE, encoding="utf-8")) if CACHE.exists() else {}
    merged, split, unsure, gone_ids = [], [], [], set()
    try:
        for a, b in list(candidates(listings)):
            if a["id"] in gone_ids or b["id"] in gone_ids:
                continue
            ha, hb = home_hashes(a, cache), home_hashes(b, cache)
            result = judge(ha, hb) if ha and hb else None
            label = f"{b['id']} ({b['title'][:35]}) / {a['id']} ({a['title'][:35]})"
            if result == "same":
                absorb(a, b, False)
                a.setdefault("notes", []).append(f"Same house as {b['id']} by its photos; merged ({dt.date.today():%d %b}).")
                gone_ids.add(b["id"])
                merged.append(label)
            elif result == "different":
                a["not_same"] = sorted(set(a.get("not_same", [])) | {b["id"]})
                b["not_same"] = sorted(set(b.get("not_same", [])) | {a["id"]})
                split.append(label)
            else:
                unsure.append(label + ("" if ha and hb else " (photos unreadable)"))
        listings = [r for r in listings if r["id"] not in gone_ids]
    finally:
        json.dump(cache, open(CACHE, "w", encoding="utf-8"), indent=0, sort_keys=True)
    if not dry:
        json.dump(listings, open(path, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    for title, rows in (("merged (same photos)", merged), ("different houses", split), ("couldn't tell", unsure)):
        for row in rows:
            print(f"  {title}: {row}")
    print(f"photo check: {len(merged)} merged, {len(split)} marked different, {len(unsure)} couldn't tell")


if __name__ == "__main__":
    args = sys.argv[1:]
    main("--dry-run" in args, Path(args[args.index("--file") + 1]) if "--file" in args else LISTINGS)

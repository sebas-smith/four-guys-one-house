# Four Guys One House

Shared list of whole 4-bed rentals in south-west London for four of us, moving around January 2027.
Target £4,000/month (£1,000 each), max £4,800 (£1,200 each), before bills.

Site: https://sebas-smith.github.io/four-guys-one-house/

## Search scope

- Areas: Putney, Southfields, Earlsfield, Wandsworth, Tooting, Balham, Wimbledon, Raynes Park,
  Clapham (SW4), Battersea, Fulham, Hammersmith, Shepherd's Bush (W12), Chiswick (W4).
- Roehampton too. Edges inside the drawn area (West Kensington/Barons Court W14) are fine.
- Excluded: Isleworth, Osterley, New Malden, Hounslow, Twickenham, Whitton (TW and KT3 postcodes).
- Whole property, 4+ bedrooms, £3,000 to £5,000 pcm tracked (recommend up to £4,800).

## How it works

- `data/listings.json` is the whole list. One object per home.
- `index.html`, `app.js`, `style.css` are a static page that reads it. No build step.
- Every evening a ChatGPT scheduled task searches the portals and agents, generates a CSV with code,
  and commits it as `sweeps/YYYY-MM-DD.csv`. `.github/workflows/sweep.yml` then runs
  `scripts/merge_sweep.py --pending`, which merges every sweep CSV that's new or was rewritten
  (hashes in `data/merged_sweeps.json`): it adds new homes, updates prices, fills blank fields and
  marks let homes gone. The other two workflows run the same catch-up, so a sweep run GitHub drops
  from the shared queue still gets merged. It never overrides a status one of us set. The git
  history shows what changed each day.
- Every morning at 05:00 UTC `.github/workflows/check.yml` runs `scripts/check_live.py`, which opens
  each live home's adverts and marks it gone when they're let agreed, under offer or taken down
  (warning only if another advert is still live). The sweep workflow runs it on the homes it just
  added. Foxtons leaves let adverts up too: its page JSON says `DOW`/`EXC` when let. A short page or
  a captcha/rate-limit page counts as unknown, never "removed".
  Rightmove and OnTheMarket work from GitHub; Zoopla, OpenRent and Jacksons/Hamptons-style agent
  sites block it, so those links are skipped.
- `scripts/agent_feeds.py` runs with the email reader and adds Marsh & Parsons homes straight from its
  website (many never reach the portals), keeping only those inside the drawn area.
- `scripts/stations.py` adds the nearest station and walk time; `scripts/dedupe.py` merges duplicates.
  Two adverts on the same portal are never merged into one home (a street often has several similar
  homes at one price), and a sweep row's links that already belong to another home stay there.
  `scripts/split_merged.py` was a one-off (25 Oct) that split homes merged by mistake.

## Alert emails

Portal alerts go straight to the bot Gmail, 4guysonehouse@gmail.com (no Google Group: nobody wanted
the emails). Housemates can read that inbox through Gmail delegation. Every 15 minutes, `.github/workflows/alerts.yml` runs
`scripts/ingest_alerts.py`. That reads the bot inbox, adds any new Rightmove, Zoopla, OnTheMarket or
OpenRent listing link to `data/listings.json`, and commits. Forward any listing email to the bot
address and it gets added too.

If a portal alert email can't be read (for example, the portal changed its layout), the Action fails
once and GitHub emails the repo owner. Marketing newsletters from the portals are skipped. If a
tracking link can't be followed, the email is left for the next run. Parser tests:
`python scripts/test_ingest.py`; it runs on real alert emails saved in `tests/emails/` (27 Oct,
with headers, account links and tracking query strings removed).

### One-time setup

1. Create a Gmail account for the bot. Turn on 2-step verification, then create an app password
   (Google Account > Security > App passwords).
2. In this repo: Settings > Secrets and variables > Actions > New repository secret. Add
   `GMAIL_ADDRESS` (the bot's address) and `GMAIL_APP_PASSWORD` (the app password).
3. Create accounts on Rightmove, Zoopla, OnTheMarket and OpenRent with the bot address. Make one
   saved search each: 4+ beds, £3,000 to £5,000 pcm, to rent, "instant" email alerts.
   `python scripts/search_area.py` prints the Rightmove, Zoopla and OnTheMarket links for the drawn
   area (all saved as "SW London house" or "London (Drawn area)"). OpenRent can't draw and only
   emails daily: it has three alerts, 5 km round Wandsworth, 3 km round Wimbledon and 3 km round
   Hammersmith.
4. Gmail settings > Accounts > Grant access to your account: add each housemate as a delegate.

## Run locally

```sh
python -m http.server 8000
```

Then open http://localhost:8000.

## Statuses

The site is read-only. The scripts set `status`: `new` (live, no tag), `no` (ruled out: out of area or
no sharers; shows "Ruled out", hidden from Active) and `gone` (let or taken down; "Gone / let").
The scripts still respect `shortlist`, `viewing` and `applied` if one is set by hand, but the site
no longer has tabs or tags for them.

## Listing fields

`id`, `title`, `area`, `rent` (monthly £), `beds`, `baths`, `available`, `sharers` (`ok` / `unknown` / `no`),
`status`, `url` (main link), `links` (every known source), `source` (`import` / `search` / `manual`),
`added` (YYYY-MM-DD), `checked`, `notes` (list of strings), `prices` (list of `[date, rent, site]`),
`station` (`{name, kind, walk}` minutes), `off_market` (`{why, checked}`, set by `check_live.py`),
`not_same` (ids of homes that look alike but aren't; `dedupe.py` never merges them).

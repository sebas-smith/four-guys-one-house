# Four Guys One House

Shared list of whole 4-bed rentals in south-west London for four of us, moving around January 2027.
Target £4,000/month (£1,000 each), max £4,800 (£1,200 each), before bills.

Site: https://sebas-smith.github.io/four-guys-one-house/

## Search scope

- Areas: Putney, Southfields, Earlsfield, Wandsworth, Tooting, Balham, Wimbledon, Raynes Park,
  Clapham South borders, Fulham, Hammersmith.
- Roehampton too. Edges inside the drawn area (Battersea, West Kensington/Barons Court W14) are fine.
- Excluded: Isleworth, Osterley, New Malden, Hounslow, Twickenham, Whitton (TW and KT3 postcodes).
- Whole property, 4+ bedrooms, £3,000 to £5,000 pcm tracked (recommend up to £4,800).

## How it works

- `data/listings.json` is the whole list. One object per home.
- `index.html`, `app.js`, `style.css` are a static page that reads it. No build step.
- Every evening a ChatGPT scheduled task searches the portals and agents, generates a CSV with code,
  and commits it as `sweeps/YYYY-MM-DD.csv`. `.github/workflows/sweep.yml` then runs
  `scripts/merge_sweep.py` on it, which adds new homes, updates prices and marks let homes gone.
  It never overrides a status one of us set. The git history shows what changed each day.
- Every morning at 05:00 UTC `.github/workflows/check.yml` runs `scripts/check_live.py`, which opens
  each live home's adverts and marks it gone when they're let agreed, under offer or taken down
  (warning only if another advert is still live). The sweep workflow runs it on that day's new homes.
  Rightmove and OnTheMarket work from GitHub; Zoopla, OpenRent and Jacksons/Hamptons-style agent
  sites block it, so those links are skipped.
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

If a portal email can't be read (for example, the portal changed its layout), the Action fails
and GitHub emails the repo owner. Parser tests: `python scripts/test_ingest.py`.

### One-time setup

1. Create a Gmail account for the bot. Turn on 2-step verification, then create an app password
   (Google Account > Security > App passwords).
2. In this repo: Settings > Secrets and variables > Actions > New repository secret. Add
   `GMAIL_ADDRESS` (the bot's address) and `GMAIL_APP_PASSWORD` (the app password).
3. Create accounts on Rightmove, Zoopla, OnTheMarket and OpenRent with the bot address. Make one
   saved search each: 4+ beds, £3,000 to £5,000 pcm, to rent, "instant" email alerts.
   `python scripts/search_area.py` prints the Rightmove, Zoopla and OnTheMarket links for the drawn
   area (all saved as "SW London house" or "London (Drawn area)"). OpenRent can't draw and only
   emails daily: it has two alerts, 5 km round Wandsworth and 3 km round Wimbledon.
4. Gmail settings > Accounts > Grant access to your account: add each housemate as a delegate.

## Run locally

```sh
python -m http.server 8000
```

Then open http://localhost:8000.

## Change a home's status

Edit its `status` in `data/listings.json` and commit:

| status      | shows as     |
| ----------- | ------------ |
| `new`       | To review    |
| `shortlist` | Shortlist    |
| `viewing`   | Viewing      |
| `applied`   | Applied      |
| `no`        | Not for us   |
| `gone`      | Gone / let   |

## Listing fields

`id`, `title`, `area`, `rent` (monthly £), `beds`, `baths`, `available`, `sharers` (`ok` / `unknown` / `no`),
`status`, `url` (main link), `links` (every known source), `source` (`import` / `search` / `manual`),
`added` (YYYY-MM-DD), `checked`, `notes` (list of strings), `prices` (list of `[date, rent, site]`),
`station` (`{name, kind, walk}` minutes), `off_market` (`{why, checked}`, set by `check_live.py`),
`not_same` (ids of homes that look alike but aren't; `dedupe.py` never merges them).

# Four Guys One House

Shared list of whole 4-bed rentals in south-west London for four of us, moving around January 2027.
Target £4,000/month (£1,000 each), max £4,800 (£1,200 each), before bills.

Site: https://sebas-smith.github.io/four-guys-one-house/

## Search scope

- Areas: Putney, Southfields, Earlsfield, Wandsworth, Tooting, Balham, Wimbledon, Raynes Park,
  Clapham South borders.
- Excluded: Isleworth, Osterley, New Malden, Twickenham, Whitton.
- Whole property, 4+ bedrooms, £3,000 to £5,000 pcm tracked (recommend up to £4,800).

## How it works

- `data/listings.json` is the whole list. One object per home.
- `index.html`, `app.js`, `style.css` are a static page that reads it. No build step.
- A daily search adds new homes to `data/listings.json` and commits them, so the git history shows what changed each day.

## Alert emails

Portal alerts go to a shared Google Group, so all four of us get them by email for quick checks.
A bot Gmail account is also in the group. Every 15 minutes, `.github/workflows/alerts.yml` runs
`scripts/ingest_alerts.py`. That reads the bot inbox, adds any new Rightmove, Zoopla, OnTheMarket or
OpenRent listing link to `data/listings.json`, and commits. Forward any listing email to the group
and it gets added too.

If a portal email can't be read (for example, the portal changed its layout), the Action fails
and GitHub emails the repo owner. Parser tests: `python scripts/test_ingest.py`.

### One-time setup

1. Create a Gmail account for the bot. Turn on 2-step verification, then create an app password
   (Google Account > Security > App passwords).
2. In this repo: Settings > Secrets and variables > Actions > New repository secret. Add
   `GMAIL_ADDRESS` (the bot's address) and `GMAIL_APP_PASSWORD` (the app password).
3. Create a Google Group at groups.google.com. Add all four of us plus the bot address.
   Set "Who can post" to members only.
4. On Rightmove, Zoopla and OnTheMarket, make one saved search each: draw the areas on the map,
   4+ beds, £3,000 to £4,800 pcm, to rent, "instant" email alerts, sent to the group address.
   Someone in the group clicks the confirmation email each portal sends.

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
`added` (YYYY-MM-DD), `notes` (list of strings).

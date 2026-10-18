# Four Guys One House

Shared list of whole 4-bed rentals in south-west London for four of us, moving around January 2027.
Target £4,000/month (£1,000 each), max £4,800 (£1,200 each), before bills.

Site: https://sebas-smith.github.io/four-guys-one-house/

## How it works

- `data/listings.json` is the whole list. One object per home.
- `index.html`, `app.js`, `style.css` are a static page that reads it. No build step.
- A daily search adds new homes to `data/listings.json` and commits them, so the git history shows what changed each day.

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

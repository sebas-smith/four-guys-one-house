# Four Guys One House: notes for Claude

Read README.md first: it explains the search, the data and every script and workflow.

## Where things stand (25 Oct 2026)

- Site live: https://sebas-smith.github.io/four-guys-one-house/ (Standouts tab first).
- ChatGPT scheduled task "SW London house sweep" runs daily 18:00 Europe/London and commits
  `sweeps/YYYY-MM-DD.csv` through its GitHub connector. It also checks the previous sweep merged.
  Since 18 Oct its instructions say to open each advert and only call it live with no "Let agreed"/
  "Under offer" label, else "unverified" (merged as To review). `check_live.py` still double-checks.
- Bot Gmail 4guysonehouse@gmail.com is set up (repo secrets `GMAIL_ADDRESS`, `GMAIL_APP_PASSWORD`);
  `alerts.yml` reads it (GitHub actually runs it every 1–4 hours, not 15 minutes). Its password
  was reset on 25 Oct, so the app password was remade the same day; if the Google password
  changes again, the app password dies and the Action logs "skipping" or fails at login.
  Seb is signed in to the bot Gmail in Chrome as the second account (`mail.google.com/mail/u/1/`).
- Portal alerts set up 25 Oct on all four portals, signed in as the bot in Chrome
  (see README "One-time setup" and `scripts/search_area.py`). Area now includes Fulham and
  Hammersmith.
- ChatGPT task instructions rewritten 25 Oct (copy in git history of this note's commit message isn't
  kept; read them in ChatGPT > Scheduled > SW London house sweep > Edit). Now: agent websites first,
  daily rechecks only of homes with no Rightmove/OnTheMarket/Marsh & Parsons link, a short portal
  backstop, Marsh & Parsons-only homes reported "unverified", "removed" only when every advert is down.
- Marsh & Parsons leaves let adverts up unlabelled; `check_live.py` asks its API instead.
  `check_live.py` sets `checked` whenever it reads an advert.

## Next steps

1. Confirm the first real portal alert emails reach the site (Rightmove/Zoopla/OTM instant,
   OpenRent once a day).
2. Gmail delegation: Seb sends the other three housemates' Gmail addresses; Claude adds them in
   the bot Gmail (Settings > Accounts > Grant access). Seb types the password if Google asks.
   No Google Group: the housemates don't want alert emails.
3. Check the first real portal alert emails parse correctly (`scripts/test_ingest.py`).
4. Maybe: buttons on the site so housemates can set a status (Shortlist, Not for us). Statuses
   currently only change by editing `data/listings.json`, so nearly everything shows "To review".

## Gotchas

- Windows: run Python with `encoding="utf-8"` on every open; heredocs mangle regex backslashes,
  so edit code with the Edit tool.
- Workflows share the `listings` concurrency group so they don't overwrite each other.
- Zoopla rate-limits after a few hundred requests from one IP; blocked fetches count as unknown.

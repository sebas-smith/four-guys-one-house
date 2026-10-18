# Four Guys One House: notes for Claude

Read README.md first: it explains the search, the data and every script and workflow.

## Where things stand (18 Oct 2026)

- Site live: https://sebas-smith.github.io/four-guys-one-house/ (Standouts tab first).
- ChatGPT scheduled task "SW London house sweep" runs daily 18:00 Europe/London and commits
  `sweeps/YYYY-MM-DD.csv` through its GitHub connector. It also checks the previous sweep merged.
  It sometimes marks let-agreed homes live; `check_live.py` corrects that.
- Bot Gmail 4guysonehouse@gmail.com is set up (repo secrets `GMAIL_ADDRESS`, `GMAIL_APP_PASSWORD`);
  `alerts.yml` reads it every 15 minutes. End-to-end test passed.
- First `check_live.py` run took 86 homes off the market; about 218 active now.

## Next steps

1. Portal alerts: Seb creates Rightmove, Zoopla, OnTheMarket and OpenRent accounts with the bot
   address (Claude can't create accounts) and stays signed in in Chrome. Claude then sets up the
   saved searches with instant alerts in Chrome (4+ beds, £3,000–£5,000, the areas in README,
   no TW/KT3), clicks the confirmation emails, and sends a test to confirm homes reach the site.
2. Gmail delegation: Seb sends the other three housemates' Gmail addresses; Claude adds them in
   the bot Gmail (Settings > Accounts > Grant access). Seb types the password if Google asks.
   No Google Group: the housemates don't want alert emails.
3. Check the first real portal alert emails parse correctly (`scripts/test_ingest.py`).
4. Check the next 18:00 sweep merges cleanly (new columns `previous_rent_gbp`, `price_reduced_on`).
5. Maybe: buttons on the site so housemates can set a status (Shortlist, Not for us). Statuses
   currently only change by editing `data/listings.json`, so nearly everything shows "To review".

## Gotchas

- Windows: run Python with `encoding="utf-8"` on every open; heredocs mangle regex backslashes,
  so edit code with the Edit tool.
- Workflows share the `listings` concurrency group so they don't overwrite each other.
- Zoopla rate-limits after a few hundred requests from one IP; blocked fetches count as unknown.

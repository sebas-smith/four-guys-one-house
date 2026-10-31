# Four Guys One House: notes for Claude

Read README.md first: it explains the search, the data and every script and workflow.

## Where things stand (27 Oct 2026)

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
  (see README "One-time setup" and `scripts/search_area.py`). On 26 Oct the area grew to take in
  Clapham (SW4), Shepherd's Bush (W12) and Chiswick (W4): new Rightmove ("SW London house v2") and
  OnTheMarket and Zoopla alerts replaced the old ones, OpenRent got a third alert (Hammersmith 3 km)
  and the ChatGPT task's scope sentence was updated. Zoopla sign-in needs an emailed code that Seb
  types; Chrome was signed in to it on 26 Oct.
- ChatGPT task instructions rewritten 25 Oct (read them in ChatGPT > Scheduled > SW London house
  sweep > ... > Edit). Now: agent websites first,
  daily rechecks only of homes with no Rightmove/OnTheMarket/Marsh & Parsons link, a short portal
  backstop, Marsh & Parsons-only homes reported "unverified", "removed" only when every advert is down.
- Marsh & Parsons leaves let adverts up unlabelled; `check_live.py` asks its API instead.
  `check_live.py` sets `checked` whenever it reads an advert.
- 27 Oct: real alerts from all four portals arrive and parse; samples are in `tests/emails/`.
  A full review fixed newsletters failing the Action, Zoopla price-cut and OpenRent parsing,
  W postcodes and West London stations, Foxtons let detection, sweep catch-up, 11 duplicates
  and the site's "was £X" and Standouts rules.

- 29 Oct check: all Actions and sweeps healthy. Ivy Crescent W4 (4 entries, one house by photos) merged into
  `marshandparsons-VBR2535277`; `onthemarket-19773630` (saved as Chartfield Avenue by the pre-fix parser,
  really Yelverton Road) folded into `rightmove-174678032`. Sample `tests/emails/onthemarket_in_your_area.eml`
  covers OnTheMarket's details-before-link layout.

- 31 Oct audit (four agents: data, coverage, pipeline, site). Fixed: OnTheMarket leaves withdrawn
  adverts up as `"status":"retracted"` (16 "live" homes were let or gone); emailed price cuts ignored
  when the portal had no earlier price; relists made duplicates; Marsh & Parsons £5,000 read as
  £5,001; Foxtons one-day false "taken down"; Dexters never read. Area grown to north Battersea, all
  of W4 and East Acton/Old Oak (W3, W10/W11 excluded); new alerts on all three drawing portals and the
  ChatGPT scope sentence updated; 31 homes already on the market backfilled from a Rightmove search.
  Site now shows a photo and the time added; notes, the New tag and "Availability unknown" removed
  at Seb's request.

## Next steps

1. Gmail delegation: Seb sends the other three housemates' Gmail addresses; Claude adds them in
   the bot Gmail (Settings > Accounts > Grant access). Seb types the password if Google asks.
   No Google Group: the housemates don't want alert emails.

Done 27 Oct: placeholder homes filled in from their adverts (two were duplicates, now merged);
emailed price changes for adverts already on the list now update the home (`new_price` in
`ingest_alerts.py`). Seb chose a read-only site: no status buttons, and the To review /
Shortlist / Viewing labels and tabs were removed.

## Gotchas

- Windows: run Python with `encoding="utf-8"` on every open; heredocs mangle regex backslashes,
  so edit code with the Edit tool.
- Workflows share the `listings` concurrency group so they don't overwrite each other.
- Zoopla rate-limits after a few hundred requests from one IP; blocked fetches count as unknown.

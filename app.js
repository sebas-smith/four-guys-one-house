// Read-only site: only closed homes get a status tag ("no" is set by the scripts: out of area, no sharers).
const STATUS = { no: "Ruled out", gone: "Gone / let" };
const CLOSED = ["no", "gone"];
const TARGET_PP = 1000, MAX_PP = 1200, PEOPLE = 4, PAGE = 60;
// A standout: live, about £4,000 (up to £4,100), 4+ beds, 2+ baths, short walk to a station, sharers not ruled out.
// Also: checked in the last few days, no advert let or taken down, beds/baths plausible, not flagged
// unverified, not a placeholder row.
const STANDOUT = { rent: 4100, beds: 4, baths: 2, walk: 8, checked: 3 };
const standout = (r) => !CLOSED.includes(r.status) && !r.off_market && r.rent && r.rent <= STANDOUT.rent && r.beds >= STANDOUT.beds &&
  r.baths >= STANDOUT.baths && r.baths <= r.beds && r.station && r.station.walk <= STANDOUT.walk && r.sharers !== "no" &&
  daysAgo(r.checked) <= STANDOUT.checked && !(r.notes || []).some((t) => /unverified/i.test(t)) &&
  !placeholder(r) && !/^unverified geography$/i.test(r.title || "");
// Rows made from an alert email before the advert has been read, e.g. "Zoopla listing 74416902".
const placeholder = (r) => /^[a-z]+ listing \d+$/i.test(r.title || "");
const SITE = {
  rightmove: "Rightmove", zoopla: "Zoopla", openrent: "OpenRent", onthemarket: "OnTheMarket",
  foxtons: "Foxtons", jacksonsestateagents: "Jacksons", dexters: "Dexters", kfh: "KFH", hamptons: "Hamptons",
  grovesresidential: "Groves", cound: "Cound", marshandparsons: "Marsh & Parsons", hawesandco: "Hawes & Co",
  savills: "Savills", knightfrank: "Knight Frank", chestertons: "Chestertons", winkworth: "Winkworth",
  johndwood: "John D Wood", barnardmarcus: "Barnard Marcus", douglasandgordon: "Douglas & Gordon",
  robertholmes: "Robert Holmes", andrewsonline: "Andrews", bairstoweves: "Bairstow Eves",
  ramptonbaseley: "Rampton Baseley", goodfellows: "Goodfellows",
};
const $ = (id) => document.getElementById(id);

let rows = [];
let filter = "standouts", sort = "newest", query = "", shown = PAGE;
const TABS = [["standouts", "Standouts"], ["active", "Active"], ["budget", "In budget"], ["gone", "Gone"], ["all", "Everything"]];
try { filter = localStorage.getItem("fgoh-filter") || filter; sort = localStorage.getItem("fgoh-sort") || sort; } catch {}
if (!TABS.some(([k]) => k === filter)) filter = "standouts";  // e.g. a saved "shortlist" tab from before

const gbp = (n) => "£" + Math.round(n).toLocaleString("en-GB");
// Only https links are shown; anything else (javascript:, http:, junk) is dropped.
const safe = (u) => { try { return new URL(u).protocol === "https:" ? u : null; } catch { return null; } };
// Site key from a URL's hostname: "search.savills.com" -> "savills", "www.rightmove.co.uk" -> "rightmove".
function siteKey(url) {
  try { const parts = new URL(url).hostname.replace(/^www\./, "").split("."); return parts.find((p) => SITE[p]) || parts[0]; } catch { return ""; }
}
const site = (url) => SITE[siteKey(url)] || siteKey(url) || "listing";
const siteName = (key) => SITE[key] || key;
// YYYY-MM-DD as a local date (new Date("2026-10-27") would be UTC midnight).
function localDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? new Date(+m[1], m[2] - 1, +m[3]) : null;
}
function daysAgo(iso) {
  const d = localDate(iso), now = new Date();
  return d ? Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - d) / 864e5) : Infinity;
}
const day = (iso) => { const d = localDate(iso); return d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : iso; };
// "31 Oct, 14:55" from added_at (UTC, shown in UK time), else just the day from added.
function added(r) {
  const t = r.added_at && new Date(r.added_at.replace(/Z$/, ":00Z"));
  if (!t || isNaN(t)) return day(r.added);
  const o = { timeZone: "Europe/London" };
  return `${t.toLocaleDateString("en-GB", { ...o, day: "numeric", month: "short" })}, ${t.toLocaleTimeString("en-GB", { ...o, hour: "2-digit", minute: "2-digit" })}`;
}
// Price entries from a real site, oldest first ("" and "search" carry no site).
const priced = (r) => (r.prices || []).filter((x) => x[2] && x[2] !== "search");
// Each site's price entries, oldest first.
function bySite(r) {
  const m = new Map();
  for (const x of priced(r)) { if (!m.has(x[2])) m.set(x[2], []); m.get(x[2]).push(x); }
  return m;
}
// Sites whose latest price is the current rent.
const atRent = (r) => [...bySite(r)].filter(([, h]) => h[h.length - 1][1] === r.rent).map(([s]) => s);
// The highest earlier price on any site now asking the current rent, or null.
function previous(r) {
  const was = atRent(r).flatMap((s) => bySite(r).get(s).map((x) => x[1])).filter((p) => p > r.rent);
  return was.length ? Math.max(...was) : null;
}
// Sites the live check found let or taken down: "Let agreed on Foxtons, still live on OnTheMarket" -> Foxtons.
function deadSites(r) {
  const m = r.off_market && /on (.+?)(,|$)/.exec(r.off_market.why || "");
  return m ? [m[1].toLowerCase()] : [];  // a shown name ("Foxtons") or a raw site key ("marshandparsons")
}
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

function matches(r) {
  if (query && !`${r.title} ${r.area}`.toLowerCase().includes(query)) return false;
  const open = !CLOSED.includes(r.status) && r.sharers !== "no";
  if (filter === "active") return open;
  if (filter === "standouts") return standout(r);
  if (filter === "budget") return open && r.rent && r.rent <= MAX_PP * PEOPLE;
  if (filter === "all") return true;
  return r.status === filter;
}

function visible() {
  const by = {
    newest: (a, b) => (b.added_at || b.added || "").localeCompare(a.added_at || a.added || ""),
    cheapest: (a, b) => (a.rent || 9e9) - (b.rent || 9e9),
  }[sort];
  return rows.filter(matches).sort(by);
}

function renderTabs() {
  const count = (f) => { const keep = filter; filter = f; const n = rows.filter(matches).length; filter = keep; return n; };
  const tabs = TABS;
  const bar = $("tabs"); bar.textContent = "";
  for (const [k, label] of tabs) {
    const b = el("button", "tab", label); b.type = "button"; b.setAttribute("aria-pressed", String(filter === k));
    b.append(el("span", "n", count(k)));
    b.onclick = () => { filter = k; shown = PAGE; try { localStorage.setItem("fgoh-filter", k); } catch {} render(); };
    bar.append(b);
  }
  const s = el("select", "sort"); s.setAttribute("aria-label", "Sort");
  for (const [k, l] of [["newest", "Newest first"], ["cheapest", "Cheapest first"]]) {
    const o = el("option", null, l); o.value = k; o.selected = sort === k; s.append(o);
  }
  s.onchange = () => { sort = s.value; try { localStorage.setItem("fgoh-sort", sort); } catch {} render(); };
  bar.append(s);
}

function card(r) {
  const row = el("article", "row" + (CLOSED.includes(r.status) ? " dim" : ""));
  const pic = safe(r.photo);
  if (pic) {
    const img = el("img", "photo"); img.src = pic; img.alt = ""; img.loading = "lazy"; img.referrerPolicy = "no-referrer";
    img.onerror = () => { img.remove(); row.classList.remove("has-photo"); };
    row.classList.add("has-photo"); row.append(img);
  }
  const where = el("div", "where");
  where.append(el("h2", "addr", r.title));
  const meta = el("div", "meta");
  if (placeholder(r)) meta.append(el("span", "tag pending", "Details pending"));
  if (standout(r)) meta.append(el("span", "tag star", "Standout"));
  if (STATUS[r.status]) meta.append(el("span", "tag status", STATUS[r.status]));
  const avail = (r.available || "").replace(/^(availability date|available( from)?)\s*:?\s*/i, "");
  for (const b of [r.area, r.beds && `${r.beds} bed`, r.baths && `${r.baths} bath`, avail && `Available ${/^\d{4}-\d\d-\d\d$/.test(avail) ? day(avail) : avail}`]) {
    if (b) meta.append(el("span", null, b));
  }
  if (r.station) meta.append(el("span", r.station.walk <= STANDOUT.walk ? "near" : null, `${r.station.walk} min walk to ${r.station.name} (${r.station.kind})`));
  if (r.added) meta.append(el("span", null, `Added ${added(r)}`));
  if (r.off_market) meta.append(el("span", "tag warn", `${r.off_market.why} (${day(r.off_market.checked)})`));
  if (r.sharers === "ok") meta.append(el("span", "tag", "Sharers OK"));
  if (r.sharers === "no") meta.append(el("span", "tag warn", "No sharers"));
  where.append(meta);

  const price = el("div", "price");
  if (r.rent) {
    const pp = r.rent / PEOPLE;
    price.append(el("div", "total", gbp(r.rent)));
    const p = el("div", "pp " + (pp <= TARGET_PP ? "good" : pp <= MAX_PP ? "warn" : "bad"));
    p.append(el("b", null, gbp(pp)), " each");
    price.append(p);
    // Struck-through only when the same site dropped its price.
    const was = previous(r);
    if (was && was > r.rent) price.append(el("div", "was", `was ${gbp(was)}`));
  } else price.append(el("div", "pp", "Price unknown"));

  const actions = el("div", "actions");
  // Open a live advert at the current price: Rightmove or OnTheMarket first (they say when a home is let).
  const links = (r.links || []).map(safe).filter(Boolean);
  const dead = deadSites(r), rank = ["rightmove", "onthemarket"];
  const ok = links.filter((u) => !dead.includes(site(u).toLowerCase()) && !dead.includes(siteKey(u)));
  const cur = atRent(r);
  const main = [...ok].sort((a, b) => (cur.includes(siteKey(b)) - cur.includes(siteKey(a))) ||
    ((rank.indexOf(siteKey(a)) + 1 || 9) - (rank.indexOf(siteKey(b)) + 1 || 9)))[0] || safe(r.url) || links[0];
  // Two adverts on one site (a relist) are numbered: "Zoopla 1", "Zoopla 2".
  const total = {}, nth = new Map();
  for (const u of links) { total[site(u)] = (total[site(u)] || 0) + 1; nth.set(u, total[site(u)]); }
  const named = (u) => site(u) + (total[site(u)] > 1 ? ` ${nth.get(u)}` : "");
  if (main) {
    const a = el("a", "open", `Open on ${named(main)} ↗`); a.href = main; a.target = "_blank"; a.rel = "noopener";
    actions.append(a);
  }
  const others = links.filter((u) => u !== main);
  if (others.length) {
    const alt = el("span", "alt", "Also on ");
    others.forEach((u, i) => {
      const a = el("a", null, named(u)); a.href = u; a.target = "_blank"; a.rel = "noopener";
      alt.append(i ? ", " : "", a);
    });
    actions.append(alt);
  }
  row.append(where, price, actions);

  // Price history, one line per site, so two sites asking different rents isn't read as a change.
  const hist = new Map([...bySite(r)].map(([s, h]) => [s, h.filter((x, i) => !i || x[1] !== h[i - 1][1])]));
  const changed = [...hist.values()].some((h) => h.length > 1);
  const differ = new Set([...hist.values()].map((h) => h[h.length - 1][1])).size > 1;
  const label = changed ? "Price history" : differ ? "Prices by site" : "";
  if (label) {
    const d = el("details", "notes");
    d.append(el("summary", null, label));
    for (const [where, h] of hist) d.append(el("p", "history", `${siteName(where)}: ` +
      h.map(([when, rent]) => `${gbp(rent)}${when ? " (" + day(when) + ")" : ""}`).join(" → ")));
    row.append(d);
  }
  return row;
}

function render() {
  renderTabs();
  const list = $("list"); list.textContent = "";
  const items = visible();
  if (!items.length) {
    const e = el("div", "empty"); e.append(el("strong", null, "Nothing here"), "Try another filter or search.");
    list.append(e); return;
  }
  items.slice(0, shown).forEach((r) => list.append(card(r)));
  if (items.length > shown) {
    const more = el("button", "more", `Show more (${items.length - shown} left)`); more.type = "button";
    more.onclick = () => { shown += PAGE; render(); };
    list.append(more);
  }
}

$("search").addEventListener("input", (e) => { query = e.target.value.trim().toLowerCase(); shown = PAGE; render(); });

fetch("data/listings.json", { cache: "no-cache" })
  .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then((data) => {
    rows = data;
    const latest = rows.reduce((m, r) => (r.added > m ? r.added : m), "");
    $("foot").textContent = `${rows.length} homes tracked. Latest addition ${latest}. Rent is the advertised monthly total; per person is split four ways. Always check the listing itself.`;
    render();
  })
  .catch(() => {
    $("list").innerHTML = '<div class="empty"><strong>Couldn\'t load the listings</strong>Reload the page to try again.</div>';
  });

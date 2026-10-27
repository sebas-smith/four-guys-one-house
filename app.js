const STATUS = {
  new: "To review", shortlist: "Shortlist", viewing: "Viewing",
  applied: "Applied", no: "Not for us", gone: "Gone / let",
};
const CLOSED = ["no", "gone"];
const TARGET_PP = 1000, MAX_PP = 1200, PEOPLE = 4, PAGE = 60;
// A standout: live, about £4,000 (up to £4,100), 4+ beds, 2+ baths, short walk to a station, sharers not ruled out.
// Also: checked in the last few days, beds/baths plausible, not flagged unverified, not a placeholder row.
const STANDOUT = { rent: 4100, beds: 4, baths: 2, walk: 8, checked: 3 };
const standout = (r) => !CLOSED.includes(r.status) && r.rent && r.rent <= STANDOUT.rent && r.beds >= STANDOUT.beds &&
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
try { filter = localStorage.getItem("fgoh-filter") || filter; sort = localStorage.getItem("fgoh-sort") || sort; } catch {}

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
const isRecent = (r) => daysAgo(r.added) < 3;
// Price entries from a real site, oldest first ("" and "search" carry no site).
const priced = (r) => (r.prices || []).filter((x) => x[2] && x[2] !== "search");
// The entry behind the current rent: the latest one at that price.
const current = (r) => priced(r).filter((x) => x[1] === r.rent).pop();
// The site's previous different price before the current one, or null.
function previous(r) {
  const cur = current(r); if (!cur) return null;
  const same = priced(r).filter((x) => x[2] === cur[2]);
  const before = same.slice(0, same.lastIndexOf(cur)).filter((x) => x[1] !== cur[1]).pop();
  return before ? before[1] : null;
}
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

function matches(r) {
  if (query && !`${r.title} ${r.area}`.toLowerCase().includes(query)) return false;
  if (filter === "active") return !CLOSED.includes(r.status);
  if (filter === "standouts") return standout(r);
  if (filter === "budget") return !CLOSED.includes(r.status) && r.rent && r.rent <= MAX_PP * PEOPLE;
  if (filter === "all") return true;
  return r.status === filter;
}

function visible() {
  const by = {
    newest: (a, b) => (b.added || "").localeCompare(a.added || ""),
    cheapest: (a, b) => (a.rent || 9e9) - (b.rent || 9e9),
  }[sort];
  return rows.filter(matches).sort(by);
}

function renderTabs() {
  const count = (f) => { const keep = filter; filter = f; const n = rows.filter(matches).length; filter = keep; return n; };
  const tabs = [["standouts", "Standouts"], ["active", "Active"], ["budget", "In budget"], ["shortlist", "Shortlist"], ["viewing", "Viewing"], ["gone", "Gone"], ["all", "Everything"]];
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
  const where = el("div", "where");
  where.append(el("h2", "addr", r.title));
  const meta = el("div", "meta");
  if (placeholder(r)) meta.append(el("span", "tag pending", "Details pending"));
  if (standout(r)) meta.append(el("span", "tag star", "Standout"));
  if (r.status === "new" && isRecent(r)) meta.append(el("span", "tag new", "New"));
  else meta.append(el("span", "tag status", STATUS[r.status] || r.status));
  for (const b of [r.area, r.beds && `${r.beds} bed`, r.baths && `${r.baths} bath`, r.available ? `Available ${r.available.replace(/^(availability date|available( from)?)\s*:?\s*/i, "")}` : "Availability unknown"]) {
    if (b) meta.append(el("span", null, b));
  }
  if (r.station) meta.append(el("span", r.station.walk <= STANDOUT.walk ? "near" : null, `${r.station.walk} min walk to ${r.station.name} (${r.station.kind})`));
  if (r.added) meta.append(el("span", null, `Added ${day(r.added)}`));
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
  // Open the site showing the current price first.
  const links = (r.links || []).map(safe).filter(Boolean);
  const cur = current(r);
  const main = (cur && links.find((u) => siteKey(u) === cur[2])) || safe(r.url) || links[0];
  if (main) {
    const a = el("a", "open", `Open on ${site(main)} ↗`); a.href = main; a.target = "_blank"; a.rel = "noopener";
    actions.append(a);
  }
  const others = links.filter((u) => u !== main);
  if (others.length) {
    const alt = el("span", "alt", "Also on ");
    others.forEach((u, i) => {
      const a = el("a", null, site(u)); a.href = u; a.target = "_blank"; a.rel = "noopener";
      alt.append(i ? ", " : "", a);
    });
    actions.append(alt);
  }
  row.append(where, price, actions);

  // Price history, one line per site, so two sites asking different rents isn't read as a change.
  const bySite = new Map();
  for (const [when, rent, where] of priced(r)) {
    const h = bySite.get(where) || []; bySite.set(where, h);
    if (!h.length || h[h.length - 1][1] !== rent) h.push([when, rent]);
  }
  const changed = [...bySite.values()].some((h) => h.length > 1);
  const differ = new Set([...bySite.values()].map((h) => h[h.length - 1][1])).size > 1;
  const label = changed ? "Price history" : differ ? "Prices by site" : "";
  if ((r.notes && r.notes.length) || label) {
    const n = (r.notes || []).length;
    const d = el("details", "notes");
    d.append(el("summary", null, [label, n ? (n === 1 ? "1 note" : `${n} notes`) : ""].filter(Boolean).join(" · ")));
    if (label) for (const [where, h] of bySite) d.append(el("p", "history", `${siteName(where)}: ` +
      h.map(([when, rent]) => `${gbp(rent)}${when ? " (" + day(when) + ")" : ""}`).join(" → ")));
    for (const t of r.notes || []) d.append(el("p", null, t));
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

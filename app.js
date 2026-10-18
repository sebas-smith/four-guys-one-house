const STATUS = {
  new: "To review", shortlist: "Shortlist", viewing: "Viewing",
  applied: "Applied", no: "Not for us", gone: "Gone / let",
};
const CLOSED = ["no", "gone"];
const TARGET_PP = 1000, MAX_PP = 1200, PEOPLE = 4, PAGE = 60;
// A standout: live, about £4,000 (up to £4,100), 4+ beds, 2+ baths, short walk to a station, sharers not ruled out.
const STANDOUT = { rent: 4100, beds: 4, baths: 2, walk: 8 };
const standout = (r) => !CLOSED.includes(r.status) && r.rent && r.rent <= STANDOUT.rent && r.beds >= STANDOUT.beds &&
  r.baths >= STANDOUT.baths && r.station && r.station.walk <= STANDOUT.walk && r.sharers !== "no";
const SITE = {
  rightmove: "Rightmove", zoopla: "Zoopla", openrent: "OpenRent", onthemarket: "OnTheMarket",
  foxtons: "Foxtons", jacksonsestateagents: "Jacksons", dexters: "Dexters", kfh: "KFH", hamptons: "Hamptons",
  grovesresidential: "Groves", cound: "Cound", marshandparsons: "Marsh & Parsons", hawesandco: "Hawes & Co",
  savills: "Savills", knightfrank: "Knight Frank", chestertons: "Chestertons", winkworth: "Winkworth",
  johndwood: "John D Wood", barnardmarcus: "Barnard Marcus", douglasandgordon: "Douglas & Gordon",
  robertholmes: "Robert Holmes", andrewsonline: "Andrews", bairstoweves: "Bairstow Eves",
};
const $ = (id) => document.getElementById(id);

let rows = [];
let filter = "active", sort = "newest", query = "", shown = PAGE;
try { filter = localStorage.getItem("fgoh-filter") || filter; sort = localStorage.getItem("fgoh-sort") || sort; } catch {}

const gbp = (n) => "£" + Math.round(n).toLocaleString("en-GB");
function site(url) {
  try { const h = new URL(url).hostname.replace(/^www\./, "").split(".")[0]; return SITE[h] || h; } catch { return "listing"; }
}
const day = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const isRecent =(r) => r.added && Date.now() - Date.parse(r.added) < 3 * 864e5;
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
    const was = Math.max(...(r.prices || []).map((x) => x[1]));
    if (was > r.rent + 50) price.append(el("div", "was", `was ${gbp(was)}`));
  } else price.append(el("div", "pp", "Price unknown"));

  const actions = el("div", "actions");
  // Open the site showing the current (lowest) price first.
  const cheapest = (r.prices || []).find((x) => x[1] === r.rent && x[2]);
  const main = (cheapest && (r.links || []).find((u) => u.includes(cheapest[2]))) || r.url;
  if (main) {
    const a = el("a", "open", `Open on ${site(main)} ↗`); a.href = main; a.target = "_blank"; a.rel = "noopener";
    actions.append(a);
  }
  const others = (r.links || []).filter((u) => u !== main);
  if (others.length) {
    const alt = el("span", "alt", "Also on ");
    others.forEach((u, i) => {
      const a = el("a", null, site(u)); a.href = u; a.target = "_blank"; a.rel = "noopener";
      alt.append(i ? ", " : "", a);
    });
    actions.append(alt);
  }
  row.append(where, price, actions);

  const history = r.prices || [];
  const changed = new Set(history.map((x) => x[1])).size > 1;
  if ((r.notes && r.notes.length) || changed) {
    const n = (r.notes || []).length + (changed ? 1 : 0);
    const d = el("details", "notes");
    d.append(el("summary", null, (changed ? "Price history · " : "") + (n === 1 ? "1 note" : `${n} notes`)));
    if (changed) d.append(el("p", "history", "Price history: " + history.map(([when, rent, where]) =>
      `${gbp(rent)}${where ? " on " + site("https://" + where + ".co.uk") : ""}${when ? " (" + day(when) + ")" : ""}`).join(" → ")));
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

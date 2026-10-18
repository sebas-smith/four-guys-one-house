const STATUS = {
  new: "To review", shortlist: "Shortlist", viewing: "Viewing",
  applied: "Applied", no: "Not for us", gone: "Gone / let",
};
const CLOSED = ["no", "gone"];
const TARGET_PP = 1000, MAX_PP = 1200, PEOPLE = 4, PAGE = 60;
const SITE = {
  rightmove: "Rightmove", zoopla: "Zoopla", openrent: "OpenRent", onthemarket: "OnTheMarket",
  foxtons: "Foxtons", jacksonsestateagents: "Jacksons", dexters: "Dexters", kfh: "KFH", hamptons: "Hamptons",
  grovesresidential: "Groves", cound: "Cound",
};
const $ = (id) => document.getElementById(id);

let rows = [];
let filter = "active", sort = "newest", query = "", shown = PAGE;
try { filter = localStorage.getItem("fgoh-filter") || filter; sort = localStorage.getItem("fgoh-sort") || sort; } catch {}

const gbp = (n) => "£" + Math.round(n).toLocaleString("en-GB");
function site(url) {
  try { const h = new URL(url).hostname.replace(/^www\./, "").split(".")[0]; return SITE[h] || h; } catch { return "listing"; }
}
const isRecent = (r) => r.added && Date.now() - Date.parse(r.added) < 3 * 864e5;
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

function matches(r) {
  if (query && !`${r.title} ${r.area}`.toLowerCase().includes(query)) return false;
  if (filter === "active") return !CLOSED.includes(r.status);
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
  const tabs = [["active", "Active"], ["budget", "In budget"], ["shortlist", "Shortlist"], ["viewing", "Viewing"], ["gone", "Gone"], ["all", "Everything"]];
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
  if (r.status === "new" && isRecent(r)) meta.append(el("span", "tag new", "New"));
  else meta.append(el("span", "tag status", STATUS[r.status] || r.status));
  for (const b of [r.area, r.beds && `${r.beds} bed`, r.baths && `${r.baths} bath`, r.available ? `Available ${r.available.replace(/^available\s*/i, "")}` : "Availability unknown"]) {
    if (b) meta.append(el("span", null, b));
  }
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
  } else price.append(el("div", "pp", "Price unknown"));

  const actions = el("div", "actions");
  if (r.url) {
    const a = el("a", "open", `Open on ${site(r.url)} ↗`); a.href = r.url; a.target = "_blank"; a.rel = "noopener";
    actions.append(a);
  }
  const others = (r.links || []).filter((u) => u !== r.url);
  if (others.length) {
    const alt = el("span", "alt", "Also on ");
    others.forEach((u, i) => {
      const a = el("a", null, site(u)); a.href = u; a.target = "_blank"; a.rel = "noopener";
      alt.append(i ? ", " : "", a);
    });
    actions.append(alt);
  }
  row.append(where, price, actions);

  if (r.notes && r.notes.length) {
    const d = el("details", "notes");
    d.append(el("summary", null, r.notes.length === 1 ? "1 note" : `${r.notes.length} notes`));
    for (const n of r.notes) d.append(el("p", null, n));
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

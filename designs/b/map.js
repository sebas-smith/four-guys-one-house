// Four Guys One House, option B: "The map room".
// The rules below (Standout, views, price history, links) are the same as the root app.js.
"use strict";

// ---- Rules shared with app.js ------------------------------------------------------------------
const STATUS = { no: "Ruled out", gone: "Gone / let" };
const CLOSED = ["no", "gone"];
const TARGET_PP = 1000, MAX_PP = 1200, PEOPLE = 4, PAGE = 60;
const STANDOUT = { rent: 4100, beds: 4, baths: 2, walk: 8, checked: 3 };
const standout = (r) => !CLOSED.includes(r.status) && !r.off_market && r.rent && r.rent <= STANDOUT.rent && r.beds >= STANDOUT.beds &&
  r.baths >= STANDOUT.baths && r.baths <= r.beds && r.station && r.station.walk <= STANDOUT.walk && r.sharers !== "no" &&
  daysAgo(r.checked) <= STANDOUT.checked && !(r.notes || []).some((t) => /unverified/i.test(t)) &&
  !placeholder(r) && !/^unverified geography$/i.test(r.title || "");
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
const VIEWS = [["standouts", "Standouts"], ["active", "Active"], ["budget", "In budget"], ["gone", "Gone"], ["all", "Everything"]];

const gbp = (n) => "£" + Math.round(n).toLocaleString("en-GB");
const safe = (u) => { try { return new URL(u).protocol === "https:" ? u : null; } catch { return null; } };
function siteKey(url) {
  try { const parts = new URL(url).hostname.replace(/^www\./, "").split("."); return parts.find((p) => SITE[p]) || parts[0]; } catch { return ""; }
}
const site = (url) => SITE[siteKey(url)] || siteKey(url) || "listing";
const siteName = (key) => SITE[key] || key;
function localDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? new Date(+m[1], m[2] - 1, +m[3]) : null;
}
function daysAgo(iso) {
  const d = localDate(iso), now = new Date();
  return d ? Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - d) / 864e5) : Infinity;
}
const day = (iso) => { const d = localDate(iso); return d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : iso; };
function added(r) {
  const t = r.added_at && new Date(r.added_at.replace(/Z$/, ":00Z"));
  if (!t || isNaN(t)) return day(r.added);
  const o = { timeZone: "Europe/London" };
  return `${t.toLocaleDateString("en-GB", { ...o, day: "numeric", month: "short" })}, ${t.toLocaleTimeString("en-GB", { ...o, hour: "2-digit", minute: "2-digit" })}`;
}
const priced = (r) => (r.prices || []).filter((x) => x[2] && x[2] !== "search");
function bySite(r) {
  const m = new Map();
  for (const x of priced(r)) { if (!m.has(x[2])) m.set(x[2], []); m.get(x[2]).push(x); }
  return m;
}
const atRent = (r) => [...bySite(r)].filter(([, h]) => h[h.length - 1][1] === r.rent).map(([s]) => s);
function previous(r) {
  const was = atRent(r).flatMap((s) => bySite(r).get(s).map((x) => x[1])).filter((p) => p > r.rent);
  return was.length ? Math.max(...was) : null;
}
function deadSites(r) {
  const m = r.off_market && /on (.+?)(,|$)/.exec(r.off_market.why || "");
  return m ? [m[1]] : [];
}
// The view rule, exactly as app.js matches().
function inView(r, f, q) {
  if (q && !`${r.title} ${r.area}`.toLowerCase().includes(q)) return false;
  const open = !CLOSED.includes(r.status) && r.sharers !== "no";
  if (f === "active") return open;
  if (f === "standouts") return standout(r);
  if (f === "budget") return open && r.rent && r.rent <= MAX_PP * PEOPLE;
  if (f === "all") return true;
  return r.status === f;
}
// Main advert and the rest, numbered when one site has two (as app.js).
function adverts(r) {
  const links = (r.links || []).map(safe).filter(Boolean);
  const dead = deadSites(r), rank = ["rightmove", "onthemarket"];
  const ok = links.filter((u) => !dead.includes(site(u)));
  const cur = atRent(r);
  const main = [...ok].sort((a, b) => (cur.includes(siteKey(b)) - cur.includes(siteKey(a))) ||
    ((rank.indexOf(siteKey(a)) + 1 || 9) - (rank.indexOf(siteKey(b)) + 1 || 9)))[0] || safe(r.url) || links[0];
  const total = {}, nth = new Map();
  for (const u of links) { total[site(u)] = (total[site(u)] || 0) + 1; nth.set(u, total[site(u)]); }
  const named = (u) => site(u) + (total[site(u)] > 1 ? ` ${nth.get(u)}` : "");
  return { main, others: links.filter((u) => u !== main), named };
}
const fit = (r) => !r.rent ? "none" : r.rent / PEOPLE <= TARGET_PP ? "good" : r.rent / PEOPLE <= MAX_PP ? "warn" : "bad";

// ---- Map furniture -----------------------------------------------------------------------------
// The drawn search area, copied from POINTS in scripts/search_area.py.
const AREA = [
  [51.4660, -0.2280], [51.4850, -0.2300], [51.4870, -0.2450], [51.4790, -0.2560],
  [51.4820, -0.2700], [51.4850, -0.2800], [51.4885, -0.2865], [51.4950, -0.2800],
  [51.5010, -0.2700], [51.5080, -0.2560], [51.5150, -0.2530], [51.5195, -0.2450],
  [51.5195, -0.2300], [51.5160, -0.2180], [51.5080, -0.2050], [51.4980, -0.2050],
  [51.4960, -0.2000], [51.4850, -0.1850], [51.4800, -0.1780], [51.4815, -0.1680],
  [51.4830, -0.1550], [51.4840, -0.1430], [51.4760, -0.1370],
  [51.4700, -0.1300], [51.4630, -0.1250], [51.4520, -0.1300],
  [51.4450, -0.1350], [51.4350, -0.1400], [51.4200, -0.1500],
  [51.4150, -0.1650], [51.4050, -0.1950], [51.4000, -0.2200], [51.4000, -0.2450],
  [51.4150, -0.2500], [51.4350, -0.2500], [51.4550, -0.2550], [51.4650, -0.2450],
];
// Atlas-style grid: columns A–I west to east, rows 1–10 north to south, each about 1.5 km.
const GRID = { n: 51.5250, w: -0.2950, dLat: 0.0135, dLon: 0.0216, cols: 9, rows: 10 };
const LETTERS = "ABCDEFGHI";
function square(lat, lon) {
  const c = Math.floor((lon - GRID.w) / GRID.dLon), r = Math.floor((GRID.n - lat) / GRID.dLat);
  return c >= 0 && c < GRID.cols && r >= 0 && r < GRID.rows ? LETTERS[c] + (r + 1) : null;
}
function squareBounds(ref) {
  const c = LETTERS.indexOf(ref[0]), r = +ref.slice(1) - 1;
  return [[GRID.n - r * GRID.dLat, GRID.w + c * GRID.dLon], [GRID.n - (r + 1) * GRID.dLat, GRID.w + (c + 1) * GRID.dLon]];
}
// Workplaces to measure from (station entrances, roughly).
const WORK = [
  ["waterloo", "Waterloo", 51.5031, -0.1132], ["victoria", "Victoria", 51.4965, -0.1447],
  ["bank", "Bank", 51.5133, -0.0886], ["kingscross", "King's Cross", 51.5308, -0.1238],
  ["paddington", "Paddington", 51.5154, -0.1755], ["canarywharf", "Canary Wharf", 51.5054, -0.0235],
  ["oxfordcircus", "Oxford Circus", 51.5152, -0.1419], ["londonbridge", "London Bridge", 51.5052, -0.0864],
  ["liverpoolst", "Liverpool Street", 51.5178, -0.0823], ["tcr", "Tottenham Court Road", 51.5165, -0.1310],
  ["whitecity", "White City", 51.5120, -0.2240], ["stratford", "Stratford", 51.5416, -0.0033],
];
const km = (a, b) => {
  const k = Math.PI / 180, x = (b[1] - a[1]) * k * Math.cos((a[0] + b[0]) / 2 * k), y = (b[0] - a[0]) * k;
  return Math.hypot(x, y) * 6371;
};
// A rough door-to-desk guess: the walk to the station, 5 minutes' wait, then about 2.2 minutes a km as the crow flies.
const roughMins = (r, w) => Math.round((r.station ? r.station.walk : 10) + 5 + km([r.pos.lat, r.pos.lon], [w[2], w[3]]) * 2.2);

// ---- Personal settings (this browser only) -----------------------------------------------------
const store = {
  get(k, d) { try { const v = localStorage.getItem("fgoh-b-" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("fgoh-b-" + k, JSON.stringify(v)); } catch {} },
};
const S = {
  view: store.get("view", "standouts"), sort: store.get("sort", "newest"), query: "", shown: PAGE,
  walk: store.get("walk", ""), kinds: new Set(store.get("kinds", [])), squares: new Set(store.get("squares", [])),
  inview: false, staronly: false, showhidden: false,
  stars: new Set(store.get("stars", [])), hidden: new Set(store.get("hidden", [])),
  work: store.get("work", []).filter((id) => WORK.some((w) => w[0] === id)).slice(0, 4),
  selected: null, picking: false,
};
if (!VIEWS.some(([k]) => k === S.view)) S.view = "standouts";
if (!["newest", "cheapest", "walk", "commute"].includes(S.sort)) S.sort = "newest";

// ---- DOM helpers -------------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const phone = () => matchMedia("(max-width: 899px)").matches;

let rows = [], byId = new Map(), stations = [], stationsByName = {};
let stnLayer, map, cluster, standoutLayer, markers = new Map(), tiles, maskLayer, edgeLayer, gridLayer, pickLayer, walkLine, workLayer;

// ---- Filtering ---------------------------------------------------------------------------------
function extra(r, withBounds) {
  if (!S.showhidden && S.hidden.has(r.id)) return false;
  if (S.staronly && !S.stars.has(r.id)) return false;
  if (S.walk && !(r.station && r.station.walk <= +S.walk)) return false;
  if (S.kinds.size && !(r.station && S.kinds.has(r.station.kind))) return false;
  if (S.squares.size && !(r.sq && S.squares.has(r.sq))) return false;
  if (withBounds && S.inview && map && !(r.pos && map.getBounds().contains([r.pos.lat, r.pos.lon]))) return false;
  return true;
}
const avgCommute = (r) => !S.work.length || !r.pos ? 9e9 : S.work.reduce((t, id) => t + roughMins(r, WORK.find((w) => w[0] === id)), 0) / S.work.length;
function sorted(list) {
  const by = {
    newest: (a, b) => (b.added_at || b.added || "").localeCompare(a.added_at || a.added || ""),
    cheapest: (a, b) => (a.rent || 9e9) - (b.rent || 9e9),
    walk: (a, b) => (a.station ? a.station.walk : 99) - (b.station ? b.station.walk : 99) || (a.rent || 9e9) - (b.rent || 9e9),
    commute: (a, b) => avgCommute(a) - avgCommute(b),
  }[S.sort];
  return list.sort(by);
}
const filtersOn = () => [S.walk, S.kinds.size, S.squares.size, S.inview, S.staronly, S.showhidden].filter(Boolean).length;

// ---- Rendering: controls -----------------------------------------------------------------------
function renderViews() {
  const bar = $("views"); bar.textContent = "";
  for (const [k, label] of VIEWS) {
    const n = rows.filter((r) => inView(r, k, S.query)).length;
    const b = el("button", "view v-" + k); b.type = "button"; b.setAttribute("aria-pressed", String(S.view === k));
    b.append(el("span", "vl", label), el("span", "n", n));
    b.onclick = () => { S.view = k; S.shown = PAGE; store.set("view", k); render(); };
    bar.append(b);
  }
}
function renderSort() {
  const s = $("sort"); s.textContent = "";
  const opts = [["newest", "Newest first"], ["cheapest", "Cheapest first"], ["walk", "Shortest walk"]];
  if (S.work.length) opts.push(["commute", "Quickest commute (rough)"]);
  if (S.sort === "commute" && !S.work.length) S.sort = "newest";
  for (const [k, l] of opts) { const o = el("option", null, l); o.value = k; o.selected = S.sort === k; s.append(o); }
}
function renderChips() {
  const kinds = $("kinds"); kinds.textContent = "";
  for (const k of ["Tube", "Rail", "Overground"]) {
    const b = el("button", "chip kind k-" + k.toLowerCase(), k); b.type = "button"; b.setAttribute("aria-pressed", String(S.kinds.has(k)));
    b.onclick = () => { S.kinds.has(k) ? S.kinds.delete(k) : S.kinds.add(k); store.set("kinds", [...S.kinds]); S.shown = PAGE; render(); };
    kinds.append(b);
  }
  const sq = $("squares");
  sq.querySelectorAll(".chip.sq").forEach((c) => c.remove());
  for (const ref of [...S.squares].sort()) {
    const b = el("button", "chip sq", ref); b.type = "button"; b.setAttribute("aria-label", `Remove square ${ref}`);
    b.append(el("span", "x", "×"));
    b.onclick = () => { S.squares.delete(ref); saveSquares(); render(); };
    sq.append(b);
  }
  $("pick").setAttribute("aria-pressed", String(S.picking));
  $("pick").textContent = S.picking ? "Picking: tap the map" : S.squares.size ? "Pick more squares" : "Pick squares on the map";
  $("walk").value = S.walk;
  $("inview").checked = S.inview; $("staronly").checked = S.staronly; $("showhidden").checked = S.showhidden;
  const n = filtersOn(); $("refine-n").textContent = n ? `${n} on` : "";
  const work = $("work"); work.textContent = "";
  for (const [id, name] of WORK) {
    const on = S.work.includes(id);
    const b = el("button", "chip wk", name); b.type = "button"; b.setAttribute("aria-pressed", String(on));
    b.disabled = !on && S.work.length >= 4;
    b.onclick = () => {
      S.work = on ? S.work.filter((x) => x !== id) : [...S.work, id].slice(0, 4);
      store.set("work", S.work); drawWork(); render();
    };
    work.append(b);
  }
  $("work-n").textContent = S.work.length ? `${S.work.length} of 4` : "";
}

// ---- Rendering: one home -----------------------------------------------------------------------
function thumb(r) {
  const box = el("div", "thumb");
  const pic = safe(r.photo);
  const ref = el("span", "ref", r.sq || "off map");
  if (pic) {
    const img = el("img"); img.src = pic; img.alt = ""; img.loading = "lazy"; img.referrerPolicy = "no-referrer";
    img.onerror = () => { img.remove(); box.classList.add("nopic"); };
    box.append(img);
  } else box.classList.add("nopic");
  box.append(ref);
  return box;
}
function card(r) {
  const sel = S.selected === r.id;
  const a = el("article", "home fit-" + fit(r) + (CLOSED.includes(r.status) ? " dim" : "") + (standout(r) ? " is-standout" : "") + (sel ? " selected" : ""));
  a.dataset.id = r.id;
  a.append(thumb(r));

  const body = el("div", "body");
  const h = el("h2", "addr");
  const open = el("button", "addr-btn", r.title); open.type = "button"; open.setAttribute("aria-expanded", String(sel));
  open.onclick = () => select(sel ? null : r.id, "list");
  h.append(open);
  if (S.stars.has(r.id)) h.append(el("span", "starmark", "★"));
  body.append(h);

  const avail = (r.available || "").replace(/^(availability date|available( from)?)\s*:?\s*/i, "");
  const facts = [r.area, r.beds && `${r.beds} bed`, r.baths && `${r.baths} bath`].filter(Boolean).join(", ");
  if (facts) body.append(el("p", "facts", facts));
  if (r.station) body.append(el("p", "stn s-" + r.station.kind.toLowerCase() + (r.station.walk <= STANDOUT.walk ? " near" : ""), `${r.station.walk} min walk to ${r.station.name} (${r.station.kind})`));
  if (avail) body.append(el("p", "facts", `Available ${/^\d{4}-\d\d-\d\d$/.test(avail) ? day(avail) : avail}`));

  const tags = el("p", "tags");
  if (standout(r)) tags.append(el("span", "tag star", "Standout"));
  if (placeholder(r)) tags.append(el("span", "tag pending", "Details pending"));
  if (STATUS[r.status]) tags.append(el("span", "tag status", STATUS[r.status]));
  if (r.sharers === "ok") tags.append(el("span", "tag", "Sharers OK"));
  if (r.sharers === "no") tags.append(el("span", "tag warn", "No sharers"));
  if (r.off_market) tags.append(el("span", "tag warn", `${r.off_market.why} (${day(r.off_market.checked)})`));
  if (S.hidden.has(r.id)) tags.append(el("span", "tag", "Hidden by you"));
  if (tags.childNodes.length) body.append(tags);

  if (S.work.length && r.pos) {
    const c = el("ul", "commute");
    for (const id of S.work) {
      const w = WORK.find((x) => x[0] === id);
      const li = el("li");
      li.append(el("b", null, w[1]), ` ${km([r.pos.lat, r.pos.lon], [w[2], w[3]]).toFixed(1)} km, about ${roughMins(r, w)} min`);
      c.append(li);
    }
    c.append(el("li", "rough", r.pos.how === "station" || r.pos.how === "area" ? "Rough guess from an approximate pin" : "Rough guess, not a journey planner"));
    body.append(c);
  }
  if (r.added) body.append(el("p", "when", `Added ${added(r)}`));
  a.append(body);

  const price = el("div", "price");
  if (r.rent) {
    const pp = el("div", "pp"); pp.append(el("b", null, gbp(r.rent / PEOPLE)), el("span", null, " each"));
    price.append(pp, el("div", "total", `${gbp(r.rent)} a month`));
    const was = previous(r);
    if (was && was > r.rent) price.append(el("div", "was", `was ${gbp(was)}`));
  } else price.append(el("div", "pp unknown", "Price unknown"));
  a.append(price);

  if (sel) a.append(detail(r));
  return a;
}
function detail(r) {
  const d = el("div", "detail");
  const pic = safe(r.photo);
  if (pic) {
    const img = el("img", "big"); img.src = pic; img.alt = `Photo of ${r.title}`; img.referrerPolicy = "no-referrer";
    img.onerror = () => img.remove();
    d.append(img);
  }
  const { main, others, named } = adverts(r);
  const acts = el("div", "acts");
  if (main) { const a = el("a", "open", `Open on ${named(main)}`); a.href = main; a.target = "_blank"; a.rel = "noopener"; acts.append(a); }
  if (others.length) {
    const alt = el("p", "alt", "Also on ");
    others.forEach((u, i) => { const a = el("a", null, named(u)); a.href = u; a.target = "_blank"; a.rel = "noopener"; alt.append(i ? ", " : "", a); });
    acts.append(alt);
  }
  d.append(acts);

  const hist = new Map([...bySite(r)].map(([s, h]) => [s, h.filter((x, i) => !i || x[1] !== h[i - 1][1])]));
  const changed = [...hist.values()].some((h) => h.length > 1);
  const differ = new Set([...hist.values()].map((h) => h[h.length - 1][1])).size > 1;
  if (changed || differ) {
    const box = el("div", "history");
    box.append(el("h3", null, changed ? "Price history" : "Prices by site"));
    for (const [where, h] of hist) box.append(el("p", null, `${siteName(where)}: ` +
      h.map(([when, rent]) => `${gbp(rent)}${when ? " (" + day(when) + ")" : ""}`).join(" → ")));
    d.append(box);
  }
  if (!r.pos) d.append(el("p", "loc", "Not on the map: the advert gives no street we can find."));
  else if (r.pos.how === "station") d.append(el("p", "loc", `Pin placed roughly, ${r.station.walk} minutes from ${r.station.name}: the advert's street isn't in our map data.`));
  else if (r.pos.how === "area") d.append(el("p", "loc", `Pin placed roughly in ${r.area}: the advert gives no street we can find.`));

  const mine = el("div", "mine");
  const star = el("button", "mini", S.stars.has(r.id) ? "Unstar" : "Star"); star.type = "button";
  star.onclick = () => { S.stars.has(r.id) ? S.stars.delete(r.id) : S.stars.add(r.id); store.set("stars", [...S.stars]); refreshMarker(r); render(); };
  const hide = el("button", "mini", S.hidden.has(r.id) ? "Unhide" : "Hide"); hide.type = "button";
  hide.onclick = () => {
    S.hidden.has(r.id) ? S.hidden.delete(r.id) : S.hidden.add(r.id); store.set("hidden", [...S.hidden]);
    if (S.hidden.has(r.id) && !S.showhidden) S.selected = null;
    render();
  };
  mine.append(star, hide);
  if (r.pos && phone()) {
    const show = el("button", "mini", "Show on map"); show.type = "button";
    show.onclick = () => { setSheet("peek"); focusMarker(r); };
    mine.append(show);
  }
  mine.append(el("span", "minenote", "Star and hide are just for you, in this browser."));
  d.append(mine);
  return d;
}

// ---- Rendering: list and map -------------------------------------------------------------------
let lastBase = [];
function render() {
  renderViews(); renderSort(); renderChips();
  const inv = rows.filter((r) => inView(r, S.view, S.query));
  const base = sorted(inv.filter((r) => extra(r, false)));
  lastBase = base;
  drawMarkers(base);
  renderList();
  drawWalk();
}
function renderList() {
  const items = lastBase.filter((r) => extra(r, true));
  const list = $("list"); list.textContent = "";
  const inv = rows.filter((r) => inView(r, S.view, S.query)).length;
  const label = VIEWS.find(([k]) => k === S.view)[1].toLowerCase();
  const hiddenN = !S.showhidden ? rows.filter((r) => inView(r, S.view, S.query) && S.hidden.has(r.id)).length : 0;
  const offmap = items.filter((r) => !r.pos).length;
  let msg = items.length === inv ? `${inv} ${inv === 1 ? "home" : "homes"} in ${label}` : `Showing ${items.length} of ${inv} in ${label}, with your filters`;
  if (hiddenN) msg += `. ${hiddenN} hidden by you`;
  if (offmap) msg += `. ${offmap} not on the map`;
  $("status").textContent = msg + ".";
  if (!items.length) {
    const e = el("div", "empty");
    e.append(el("b", null, "No homes here"), S.inview ? "Zoom out or move the map, or untick “Only homes in the map view”." : filtersOn() ? "Loosen the filters under Refine, or try another view." : "Try another view or search.");
    list.append(e); return;
  }
  if (S.selected) { const i = items.findIndex((r) => r.id === S.selected); if (i >= S.shown) S.shown = Math.ceil((i + 1) / PAGE) * PAGE; }
  for (const r of items.slice(0, S.shown)) list.append(card(r));
  if (items.length > S.shown) {
    const more = el("button", "more", `Show more (${items.length - S.shown} left)`); more.type = "button";
    more.onclick = () => { S.shown += PAGE; renderList(); };
    list.append(more);
  }
}

function pinHtml(r) {
  const cls = ["pin", "fit-" + fit(r)];
  if (standout(r)) cls.push("standout");
  if (CLOSED.includes(r.status)) cls.push("gone");
  if (r.pos.how === "station" || r.pos.how === "area") cls.push("approx");
  if (S.stars.has(r.id)) cls.push("starred");
  if (S.selected === r.id) cls.push("sel");
  const txt = r.rent ? gbp(r.rent / PEOPLE) : "?";
  return `<span class="${cls.join(" ")}">${txt}</span>`;
}
function makeIcon(r) { return L.divIcon({ className: "pinwrap", html: pinHtml(r), iconSize: [0, 0], iconAnchor: [0, 0] }); }
function refreshMarker(r) { const m = markers.get(r.id); if (m) m.setIcon(makeIcon(r)); }
function drawMarkers(list) {
  cluster.clearLayers(); standoutLayer.clearLayers();
  const plain = [], stars = [];
  for (const r of list) {
    if (!r.pos) continue;
    let m = markers.get(r.id);
    if (!m) {
      m = L.marker([r.pos.lat, r.pos.lon], { icon: makeIcon(r), keyboard: true, title: r.title, riseOnHover: true });
      m.home = r;
      m.on("click", () => select(r.id, "map"));
      m.on("mouseover", () => hot(r.id, true));
      m.on("mouseout", () => hot(r.id, false));
      markers.set(r.id, m);
    } else m.setIcon(makeIcon(r));
    m.setZIndexOffset(standout(r) ? 1000 : CLOSED.includes(r.status) ? -500 : 0);
    // Standouts are never folded into a cluster, so they always show.
    (standout(r) ? stars : plain).push(m);
  }
  cluster.addLayers(plain); standoutLayer.addLayers(stars);
}
function clusterIcon(c, star) {
  const homes = c.getAllChildMarkers().map((m) => m.home);
  const rents = homes.filter((h) => h.rent && !CLOSED.includes(h.status)).map((h) => h.rent / PEOPLE);
  const low = rents.length ? Math.min(...rents) : null;
  const f = low == null ? "none" : low <= TARGET_PP ? "good" : low <= MAX_PP ? "warn" : "bad";
  const html = `<span class="clu fit-${f}${star ? " star" : ""}"><b>${star ? "★ " : ""}${homes.length}</b>${low ? `<span>from ${gbp(low)}</span>` : ""}</span>`;
  return L.divIcon({ className: "pinwrap", html, iconSize: [0, 0] });
}
function hot(id, on) {
  const c = document.querySelector(`.home[data-id="${CSS.escape(id)}"]`);
  if (c) c.classList.toggle("hot", on);
}
// The pin for a home, or the cluster it is folded into when zoomed out.
function markerEl(id) {
  const m = markers.get(id);
  if (!m) return null;
  const g = cluster.hasLayer(m) ? cluster : standoutLayer.hasLayer(m) ? standoutLayer : null;
  const v = g ? g.getVisibleParent(m) : m;
  return v && v._icon ? v._icon.querySelector(".pin, .clu") : null;
}

function focusMarker(r) {
  const m = markers.get(r.id);
  if (!m) return;
  const g = cluster.hasLayer(m) ? cluster : standoutLayer.hasLayer(m) ? standoutLayer : null;
  if (g) g.zoomToShowLayer(m, () => map.panTo(m.getLatLng()));
  else map.setView(m.getLatLng(), Math.max(map.getZoom(), 15));
}
function select(id, from) {
  const prev = S.selected; S.selected = id;
  for (const x of [prev, id]) { const r = x && byId.get(x); if (r) refreshMarker(r); }
  renderList(); drawWalk();
  if (!id) return;
  const r = byId.get(id);
  if (from === "map") {
    if (phone() && $("app").dataset.sheet === "peek") setSheet("half");
  } else if (r.pos && !phone()) focusMarker(r);
  requestAnimationFrame(() => {
    const c = document.querySelector(`.home[data-id="${CSS.escape(id)}"]`);
    if (c) {
      c.scrollIntoView({ block: from === "map" ? "start" : "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      if (from === "map") c.querySelector(".addr-btn").focus({ preventScroll: true });
    }
  });
}
function drawWalk() {
  if (walkLine) { map.removeLayer(walkLine); walkLine = null; }
  const r = S.selected && byId.get(S.selected);
  const st = r && r.pos && r.station && stationsByName[r.station.name];
  if (!st || r.pos.how === "station") return;
  walkLine = L.polyline([[r.pos.lat, r.pos.lon], [st.lat, st.lon]], { color: css("--ink"), weight: 2.5, dashArray: "2 6", lineCap: "round", interactive: false })
    .bindTooltip(`${r.station.walk} min walk`, { permanent: true, direction: "center", className: "walktip" }).addTo(map);
}
function drawWork() {
  workLayer.clearLayers();
  for (const id of S.work) {
    const w = WORK.find((x) => x[0] === id);
    L.marker([w[2], w[3]], { icon: L.divIcon({ className: "pinwrap", html: `<span class="work">${w[1]}</span>`, iconSize: [0, 0] }), interactive: false }).addTo(workLayer);
  }
}

// ---- Map setup ---------------------------------------------------------------------------------
// Esri's grey canvas basemaps need no key (CARTO's now answer "API key required"). Base and labels are
// separate layers so the labels sit above the search-area wash.
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/";
const TILE = {
  light: [ESRI + "World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", ESRI + "World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}"],
  dark: [ESRI + "World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", ESRI + "World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}"],
};
const darkMQ = matchMedia("(prefers-color-scheme: dark)");
// ?theme=light or ?theme=dark forces a theme (handy for checking both); otherwise the device decides.
const forced = new URLSearchParams(location.search).get("theme");
if (forced === "light" || forced === "dark") document.documentElement.dataset.theme = forced;
const dark = { get matches() { return forced === "dark" || (forced !== "light" && darkMQ.matches); } };
function setTheme() {
  if (tiles) tiles.forEach((t) => map.removeLayer(t));
  const [base, ref] = dark.matches ? TILE.dark : TILE.light;
  const o = { maxZoom: 19, maxNativeZoom: 16 };
  tiles = [
    L.tileLayer(base, { ...o, attribution: 'Tiles &copy; Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map),
    L.tileLayer(ref, { ...o, pane: "labels" }).addTo(map),
  ];
  maskLayer.setStyle({ fillColor: css("--mask") });
  edgeLayer.setStyle({ color: css("--edge") });
  gridLayer.eachLayer((l) => l.setStyle && l.setStyle({ color: css("--grid") }));
  pickLayer.eachLayer((l) => l.setStyle({ color: css("--edge"), fillColor: css("--edge") }));
  if (stnLayer) stnLayer.eachLayer((l) => l.kind && l.setStyle({ color: css("--k-" + l.kind.toLowerCase()) }));
  drawWalk();
}
function saveSquares() { store.set("squares", [...S.squares]); drawPicked(); }
function drawPicked() {
  pickLayer.clearLayers();
  for (const ref of S.squares) L.rectangle(squareBounds(ref), { color: css("--edge"), weight: 2, fillColor: css("--edge"), fillOpacity: 0.12, interactive: false }).addTo(pickLayer);
}
function setPicking(on) {
  S.picking = on;
  $("pickbar").hidden = !on;
  map.getContainer().classList.toggle("picking", on);
  if (on && phone()) setSheet("peek");
  renderChips();
}
function initMap() {
  map = L.map("map", { zoomSnap: 0.5, minZoom: 10, maxZoom: 19, maxBounds: [[51.25, -0.6], [51.7, 0.15]], attributionControl: true })
    .fitBounds(L.latLngBounds(AREA).pad(0.02), { paddingBottomRight: [0, phone() ? Math.round(innerHeight * 0.52) : 0] });
  map.createPane("mask").style.zIndex = 350;
  map.createPane("labels").style.zIndex = 370;
  map.getPane("labels").style.pointerEvents = "none";
  map.createPane("grid").style.zIndex = 360;
  map.createPane("gridlbl").style.zIndex = 380;
  map.createPane("stn").style.zIndex = 420;
  map.getPane("gridlbl").style.pointerEvents = "none";

  maskLayer = L.polygon([[[52.2, -1.5], [52.2, 1], [50.8, 1], [50.8, -1.5]], AREA], { pane: "mask", stroke: false, fillOpacity: 0.42, interactive: false }).addTo(map);
  edgeLayer = L.polygon(AREA, { pane: "mask", weight: 2.5, fill: false, dashArray: "10 5 2 5", interactive: false }).addTo(map);

  gridLayer = L.layerGroup().addTo(map);
  const S0 = GRID.n - GRID.rows * GRID.dLat, E0 = GRID.w + GRID.cols * GRID.dLon;
  for (let c = 0; c <= GRID.cols; c++) L.polyline([[GRID.n, GRID.w + c * GRID.dLon], [S0, GRID.w + c * GRID.dLon]], { pane: "grid", weight: 1, opacity: 0.55, interactive: false }).addTo(gridLayer);
  for (let r = 0; r <= GRID.rows; r++) L.polyline([[GRID.n - r * GRID.dLat, GRID.w], [GRID.n - r * GRID.dLat, E0]], { pane: "grid", weight: 1, opacity: 0.55, interactive: false }).addTo(gridLayer);
  const lbl = (ll, t, cls) => L.marker(ll, { pane: "gridlbl", interactive: false, keyboard: false, icon: L.divIcon({ className: "pinwrap", html: `<span class="${cls}">${t}</span>`, iconSize: [0, 0] }) }).addTo(gridLayer);
  for (let c = 0; c < GRID.cols; c++) for (let r = 0; r < GRID.rows; r++) lbl([GRID.n - r * GRID.dLat, GRID.w + c * GRID.dLon], LETTERS[c] + (r + 1), "cell");
  pickLayer = L.layerGroup().addTo(map);

  stnLayer = L.layerGroup().addTo(map);
  for (const s of stations) {
    L.circleMarker([s.lat, s.lon], { pane: "stn", radius: 5, weight: 2.5, color: css("--k-" + s.kind.toLowerCase()) || css("--ink"), fillColor: "#fff", fillOpacity: 1, className: "stnpt" })
      .on("add", function () { this.kind = s.kind; })
      .bindTooltip(`${s.name}<small>${s.kind}</small>`, { permanent: true, direction: "right", offset: [6, 0], className: "stnlbl" })
      .addTo(stnLayer);
  }
  workLayer = L.layerGroup().addTo(map);

  cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 60, disableClusteringAtZoom: 16, spiderfyOnMaxZoom: true, iconCreateFunction: clusterIcon, chunkedLoading: true });
  // Standouts get their own tighter clusters, ringed in magenta, so they never vanish into the rest.
  standoutLayer = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 34, disableClusteringAtZoom: 14, spiderfyOnMaxZoom: true, iconCreateFunction: (c) => clusterIcon(c, true) });
  map.addLayer(cluster); map.addLayer(standoutLayer);

  const zoomClass = () => {
    const z = map.getZoom(), c = map.getContainer().classList;
    c.toggle("z13", z >= 13); c.toggle("z14", z >= 14);
    stnLayer.eachLayer((l) => l.setRadius && l.setRadius(z >= 14 ? 6 : z >= 12.5 ? 4.5 : 3));
  };
  map.on("zoomend", zoomClass); zoomClass();
  map.on("moveend", () => { if (S.inview) renderList(); });
  map.on("click", (e) => {
    if (!S.picking) return;
    const ref = square(e.latlng.lat, e.latlng.lng);
    if (!ref) return;
    S.squares.has(ref) ? S.squares.delete(ref) : S.squares.add(ref);
    S.shown = PAGE; saveSquares(); render();
  });
  setTheme(); drawPicked(); drawWork();
  darkMQ.addEventListener("change", setTheme);
}

// ---- Phone bottom sheet ------------------------------------------------------------------------
function setSheet(state) { $("app").dataset.sheet = state; $("handle").setAttribute("aria-label", state === "full" ? "Show more of the map" : "Show more of the list"); }
function initSheet() {
  const handle = $("handle"), side = $("side");
  let startY = null, startT = 0, moved = false;
  const order = ["peek", "half", "full"];
  handle.addEventListener("pointerdown", (e) => {
    if (!phone()) return;
    startY = e.clientY; moved = false; startT = side.getBoundingClientRect().top;
    handle.setPointerCapture(e.pointerId); side.classList.add("dragging");
  });
  handle.addEventListener("pointermove", (e) => {
    if (startY == null) return;
    const dy = e.clientY - startY;
    if (Math.abs(dy) > 6) moved = true;
    if (moved) side.style.top = `${Math.max(8, Math.min(innerHeight - 90, startT + dy))}px`;
  });
  const end = (e) => {
    if (startY == null) return;
    side.classList.remove("dragging"); side.style.top = "";
    const dy = e.clientY - startY, cur = order.indexOf($("app").dataset.sheet);
    startY = null;
    if (!moved) { setSheet(cur === 2 ? "half" : order[cur + 1]); return; }
    setSheet(order[Math.max(0, Math.min(2, cur + (dy < -60 ? 1 : dy > 60 ? -1 : 0) + (dy < -320 ? 1 : dy > 320 ? -1 : 0)))]);
  };
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
  handle.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault(); const cur = order.indexOf($("app").dataset.sheet); setSheet(cur === 2 ? "half" : order[cur + 1]);
  });
}

// ---- Wiring ------------------------------------------------------------------------------------
function wire() {
  $("search").addEventListener("input", (e) => { S.query = e.target.value.trim().toLowerCase(); S.shown = PAGE; render(); });
  $("sort").addEventListener("change", (e) => { S.sort = e.target.value; store.set("sort", S.sort); render(); });
  $("walk").addEventListener("change", (e) => { S.walk = e.target.value; store.set("walk", S.walk); S.shown = PAGE; render(); });
  $("inview").addEventListener("change", (e) => { S.inview = e.target.checked; S.shown = PAGE; render(); });
  $("staronly").addEventListener("change", (e) => { S.staronly = e.target.checked; S.shown = PAGE; render(); });
  $("showhidden").addEventListener("change", (e) => { S.showhidden = e.target.checked; S.shown = PAGE; render(); });
  $("pick").addEventListener("click", () => setPicking(!S.picking));
  $("pickdone").addEventListener("click", () => { setPicking(false); if (phone()) setSheet("half"); });
  $("clear").addEventListener("click", () => {
    S.walk = ""; S.kinds.clear(); S.squares.clear(); S.inview = S.staronly = S.showhidden = false;
    store.set("walk", ""); store.set("kinds", []); saveSquares(); setPicking(false); render();
  });
  $("keybtn").addEventListener("click", () => $("key").showModal());
  $("key").addEventListener("click", (e) => { if (e.target === $("key")) $("key").close(); });
  $("list").addEventListener("mouseover", (e) => {
    const c = e.target.closest(".home"); document.querySelectorAll(".hot:not(.home)").forEach((p) => p.classList.remove("hot"));
    const p = c && markerEl(c.dataset.id); if (p) p.classList.add("hot");
  });
  $("list").addEventListener("mouseleave", () => document.querySelectorAll(".hot:not(.home)").forEach((p) => p.classList.remove("hot")));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && S.picking) setPicking(false); });
}

const load = (u) => fetch(u, { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); });
Promise.all([load("../../data/listings.json"), load("../../data/stations.json"), load("../../data/geo.json").catch(() => ({}))])
  .then(([data, st, geo]) => {
    stations = st; stationsByName = Object.fromEntries(st.map((s) => [s.name, s]));
    rows = data;
    for (const r of rows) {
      r.pos = FGOHGeo.place(r, geo, stationsByName);
      r.sq = r.pos ? square(r.pos.lat, r.pos.lon) : null;
      byId.set(r.id, r);
    }
    const counts = rows.reduce((m, r) => ((m[r.pos ? r.pos.how : "none"] = (m[r.pos ? r.pos.how : "none"] || 0) + 1), m), {});
    window.FGOH_PLACED = counts;
    const latest = rows.reduce((m, r) => (r.added > m ? r.added : m), "");
    const exact = (counts.street || 0) + (counts.name || 0);
    $("foot").textContent = `${rows.length} homes tracked, latest added ${day(latest)}. ${exact} are pinned to their street; the rest sit near their station. Rent is the advertised monthly total; each is split four ways. Always check the advert itself.`;
    initMap(); wire(); initSheet();
    render();
  })
  .catch((err) => {
    console.error(err);
    $("list").innerHTML = '<div class="empty"><b>Couldn\'t load the homes</b>Reload the page to try again.</div>';
  });

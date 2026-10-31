// Four Guys One House: the rental desk. Read-only; personal stars/hides live in this browser only.
"use strict";

// ---- Rules, kept identical to the root app.js ----
const STATUS = { no: "Ruled out", gone: "Gone / let" };
const CLOSED = ["no", "gone"];
const TARGET_PP = 1000, MAX_PP = 1200, PEOPLE = 4, PAGE = 80;
const STANDOUT = { rent: 4100, beds: 4, baths: 2, walk: 8, checked: 3 };
const placeholder = (r) => /^[a-z]+ listing \d+$/i.test(r.title || "");
const standout = (r) => !CLOSED.includes(r.status) && !r.off_market && r.rent && r.rent <= STANDOUT.rent && r.beds >= STANDOUT.beds &&
  r.baths >= STANDOUT.baths && r.baths <= r.beds && r.station && r.station.walk <= STANDOUT.walk && r.sharers !== "no" &&
  daysAgo(r.checked) <= STANDOUT.checked && !(r.notes || []).some((t) => /unverified/i.test(t)) &&
  !placeholder(r) && !/^unverified geography$/i.test(r.title || "");
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
function today() { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
function daysAgo(iso) { const d = localDate(iso); return d ? Math.round((today() - d) / 864e5) : Infinity; }
const day = (iso) => { const d = localDate(iso); return d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : iso; };
const addedTime = (r) => { const t = r.added_at && new Date(r.added_at.replace(/Z$/, ":00Z")); return t && !isNaN(t) ? t : null; };
function added(r) {
  const t = addedTime(r);
  if (!t) return day(r.added);
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
// Price history per site with repeats folded, as the root site shows it.
const history = (r) => new Map([...bySite(r)].map(([s, h]) => [s, h.filter((x, i) => !i || x[1] !== h[i - 1][1])]));
// The main link and the numbered extra links, exactly as app.js picks them.
function linksOf(r) {
  const links = (r.links || []).map(safe).filter(Boolean);
  const dead = deadSites(r), rank = ["rightmove", "onthemarket"];
  const ok = links.filter((u) => !dead.includes(site(u)));
  const cur = atRent(r);
  const main = [...ok].sort((a, b) => (cur.includes(siteKey(b)) - cur.includes(siteKey(a))) ||
    ((rank.indexOf(siteKey(a)) + 1 || 9) - (rank.indexOf(siteKey(b)) + 1 || 9)))[0] || safe(r.url) || links[0];
  const total = {}, nth = new Map();
  for (const u of links) { total[site(u)] = (total[site(u)] || 0) + 1; nth.set(u, total[site(u)]); }
  const named = (u) => site(u) + (total[site(u)] > 1 ? ` ${nth.get(u)}` : "");
  return { main, named, others: links.filter((u) => u !== main) };
}
// When a home first went off the market. off_market.checked is the latest recheck, so read the date
// from the note the scripts wrote when it first happened ("Let agreed on Foxtons (27 Oct).").
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function noteDate(n) {
  let m = /\((\d{4})-(\d\d)-(\d\d)\)/.exec(n);
  if (m) return new Date(+m[1], m[2] - 1, +m[3]);
  m = /\((\d{1,2}) ([A-Z][a-z]{2})\)/.exec(n);
  if (m && m[2].toLowerCase() in MONTHS) {
    const t = today(); let d = new Date(t.getFullYear(), MONTHS[m[2].toLowerCase()], +m[1]);
    if (d - t > 864e5) d = new Date(t.getFullYear() - 1, d.getMonth(), d.getDate());
    return d;
  }
  return null;
}
function offDate(r) {
  if (!r.off_market) return null;
  if (r._off !== undefined) return r._off;
  const notes = r.notes || [];
  const exact = notes.find((n) => n.startsWith(r.off_market.why) && noteDate(n));
  const any = [...notes].reverse().find((n) => /^(Let agreed|Let on|Advert taken down|Marked gone|ChatGPT sweep says (let|removed))/.test(n) && noteDate(n));
  return (r._off = (exact && noteDate(exact)) || (any && noteDate(any)) || localDate(r.off_market.checked));
}
const ppClass = (pp) => (pp <= TARGET_PP ? "good" : pp <= MAX_PP ? "warn" : "bad");
const availText = (r) => {
  const a = (r.available || "").replace(/^(availability date|available( from)?)\s*:?\s*/i, "");
  return a ? (/^\d{4}-\d\d-\d\d$/.test(a) ? day(a) : a) : "";
};

// ---- Area: the data's free-text areas folded into the search areas, for filters and charts ----
const AREAS = [
  ["Shepherd's Bush", /shepherd|\bw12\b|east acton|old oak/i], ["Chiswick", /chiswick|\bw4\b/i],
  ["Hammersmith", /hammersmith|ravenscourt|\bw6\b/i], ["Fulham", /fulham|parsons green|\bsw6\b/i],
  ["Battersea", /battersea|\bsw11\b|\bsw8\b/i], ["Clapham", /clapham|\bsw4\b/i], ["Balham", /balham|\bsw12\b/i],
  ["Tooting", /tooting|furzedown|\bsw17\b/i], ["Earlsfield", /earlsfield/i], ["Southfields", /southfields/i],
  ["Wimbledon", /wimbledon|merton|\bsw19\b/i], ["Raynes Park", /raynes|\bsw20\b/i], ["Roehampton", /roehampton/i],
  ["Putney", /putney|\bsw15\b/i], ["Wandsworth", /wandsworth|\bsw18\b/i],
  ["Outside area", /malden|isleworth|osterley|outside|brixton|streatham|twickenham|hounslow|acton|notting|unverified|\bw3\b|\bw1[01]\b/i],
];
function canon(text) {
  let best = null, at = Infinity;
  for (const [name, re] of AREAS) { const m = re.exec(text || ""); if (m && m.index < at) { at = m.index; best = name; } }
  return best;
}
const areaOf = (r) => r._area || (r._area = canon(r.area) || canon(r.title) || "Other");

// ---- Personal storage ----
const KEY = "fgoh-d-";
const store = {
  get(k, d) { try { const v = localStorage.getItem(KEY + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch {} },
};

// ---- State ----
const $ = (id) => document.getElementById(id);
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
const SVGNS = "http://www.w3.org/2000/svg";
function sv(tag, attrs, text) { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text != null) e.textContent = text; return e; }

let rows = [], byId = new Map();
let view = store.get("view", "standouts");
if (!VIEWS.some(([k]) => k === view) && view !== "stars") view = "standouts";
let sort = store.get("sort", { key: "added", dir: "desc" });
let query = "", shown = PAGE, cursor = -1, openId = null;
const chips = Object.assign({ areas: [], beds: 0, baths: 0, each: 0, walk: 0 }, store.get("chips", {}));
const stars = new Set(store.get("stars", []));
const hidden = new Set(store.get("hidden", []));
let showHidden = false;
const lastVisit = store.get("lastVisit", null);   // ms; homes added after this get a dot
store.set("lastVisit", Date.now());

// ---- Filtering (view logic identical to app.js) ----
function inView(r, v) {
  if (query && !`${r.title} ${r.area}`.toLowerCase().includes(query)) return false;
  const open = !CLOSED.includes(r.status) && r.sharers !== "no";
  if (v === "active") return open;
  if (v === "standouts") return standout(r);
  if (v === "budget") return open && r.rent && r.rent <= MAX_PP * PEOPLE;
  if (v === "all") return true;
  if (v === "stars") return stars.has(r.id);
  return r.status === v;
}
function passChips(r) {
  if (chips.areas.length && !chips.areas.includes(areaOf(r))) return false;
  if (chips.beds && !(r.beds >= chips.beds)) return false;
  if (chips.baths && !(r.baths >= chips.baths)) return false;
  if (chips.each && !(r.rent && r.rent / PEOPLE <= chips.each)) return false;
  if (chips.walk && !(r.station && r.station.walk <= chips.walk)) return false;
  return true;
}
const chipsOn = () => chips.areas.length || chips.beds || chips.baths || chips.each || chips.walk;
const statusRank = (r) => (standout(r) ? 0 : !CLOSED.includes(r.status) ? (r.off_market ? 2 : 1) : r.status === "no" ? 3 : 4);
const SORTS = {
  added: (r) => r.added_at || r.added || null,
  rent: (r) => r.rent || null,
  beds: (r) => r.beds || null,
  baths: (r) => r.baths || null,
  walk: (r) => (r.station ? r.station.walk : null),
  title: (r) => (r.title || "").toLowerCase() || null,
  area: (r) => areaOf(r).toLowerCase(),
  status: statusRank,
};
function sorter() {
  const f = SORTS[sort.key] || SORTS.added, s = sort.dir === "asc" ? 1 : -1;
  return (a, b) => {
    const x = f(a), y = f(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === "string" ? x.localeCompare(y) : x - y) * s;
  };
}
function visible() {
  return rows.filter((r) => inView(r, view) && passChips(r) && (showHidden || !hidden.has(r.id))).sort(sorter());
}
function hiddenInView() { return rows.filter((r) => inView(r, view) && passChips(r) && hidden.has(r.id)).length; }

// ---- Views and controls ----
function renderViews() {
  const bar = $("views"); bar.textContent = "";
  const list = [...VIEWS, ["stars", "My stars"]];
  for (const [k, label] of list) {
    const b = el("button", "view" + (k === "stars" ? " mine" : ""));
    b.type = "button"; b.setAttribute("aria-pressed", String(view === k));
    const n = rows.filter((r) => inView(r, k) && passChips(r) && (showHidden || !hidden.has(r.id))).length;
    b.append(el("span", null, k === "stars" ? "★ My stars" : label), el("b", null, String(n)));
    if (k === "stars") b.title = "Homes you starred. Saved in this browser only.";
    b.onclick = () => { view = k; shown = PAGE; cursor = -1; store.set("view", k); render(); };
    bar.append(b);
  }
}

function chipGroup(label, key, options) {
  const g = el("span", "chipset"); g.append(el("span", null, label));
  for (const [v, text] of options) {
    const c = el("button", "chip", text); c.type = "button"; c.setAttribute("aria-pressed", String(chips[key] === v));
    c.onclick = () => { chips[key] = chips[key] === v ? 0 : v; saveChips(); };
    g.append(c);
  }
  return g;
}
function saveChips() { store.set("chips", chips); shown = PAGE; cursor = -1; render(); }
function renderChips() {
  const box = $("chips"); const wasOpen = box.querySelector(".areapick")?.open; box.textContent = "";
  // Area picker
  const d = el("details", "areapick" + (chips.areas.length ? " on" : ""));
  const counts = {};
  for (const r of rows) if (inView(r, view)) counts[areaOf(r)] = (counts[areaOf(r)] || 0) + 1;
  d.append(el("summary", null, chips.areas.length ? (chips.areas.length === 1 ? chips.areas[0] : `${chips.areas.length} areas`) : "Any area ▾"));
  const menu = el("div", "menu");
  for (const [name] of [...AREAS, ["Other"]]) {
    const lab = el("label"); const cb = el("input"); cb.type = "checkbox"; cb.checked = chips.areas.includes(name);
    cb.onchange = () => { chips.areas = cb.checked ? [...chips.areas, name] : chips.areas.filter((a) => a !== name); saveChips(); };
    lab.append(cb, el("span", null, name), el("small", null, String(counts[name] || 0)));
    menu.append(lab);
  }
  const done = el("button", "chip", "Done"); done.type = "button"; done.onclick = () => { d.open = false; };
  menu.append(done); d.append(menu); if (wasOpen) d.open = true;
  const ga = el("span", "chipset"); ga.append(el("span", null, "Area"), d);
  box.append(ga,
    chipGroup("Beds", "beds", [[4, "4+"], [5, "5+"]]),
    chipGroup("Baths", "baths", [[2, "2+"], [3, "3+"]]),
    chipGroup("Each up to", "each", [[1000, "£1,000"], [1100, "£1,100"], [1200, "£1,200"]]),
    chipGroup("Walk", "walk", [[5, "5 min"], [8, "8 min"], [12, "12 min"]]));
  if (chipsOn()) {
    const c = el("button", "clear", "Clear filters"); c.type = "button";
    c.onclick = () => { Object.assign(chips, { areas: [], beds: 0, baths: 0, each: 0, walk: 0 }); saveChips(); };
    box.append(c);
  }
}

function renderSortUi() {
  for (const th of document.querySelectorAll(".grid thead th")) {
    const b = th.querySelector("button[data-sort]");
    if (!b) continue;
    const isMain = b.dataset.sort === sort.key && !(th.classList.contains("c-each"));
    if (isMain) th.setAttribute("aria-sort", sort.dir === "asc" ? "ascending" : "descending"); else th.removeAttribute("aria-sort");
  }
  const sel = $("sortSel"); const v = `${sort.key}:${sort.dir}`;
  if (![...sel.options].some((o) => o.value === v)) {
    const o = el("option", "custom", "Custom sort"); o.value = v; sel.querySelector(".custom")?.remove(); sel.append(o);
  }
  sel.value = v;
}

// ---- Rows ----
function thumb(r, big) {
  const box = el("span", big ? "xp-pic-in" : "thumb");
  const pic = safe(r.photo);
  const fallback = () => { const n = el("span", "nopic", r.beds ? `${r.beds} bd` : "—"); n.setAttribute("aria-hidden", "true"); return n; };
  if (pic) {
    const img = el("img"); img.src = pic; img.alt = big ? `Photo of ${r.title}` : ""; img.loading = "lazy"; img.referrerPolicy = "no-referrer"; img.decoding = "async";
    img.onerror = () => img.replaceWith(fallback());
    box.append(img);
  } else box.append(fallback());
  return box;
}
function statusCell(r) {
  if (r.status === "gone") return el("span", "st-gone", "Gone / let");
  if (r.status === "no") return el("span", "st-no", "Ruled out");
  if (r.off_market) return el("span", "st-check", "Check");
  return el("span", "st-live", "Live");
}
function tagsFor(r, mobile) {
  const t = el("div", "tags");
  if (placeholder(r)) t.append(el("span", "tag", "Details pending"));
  if (standout(r)) t.append(el("span", "tag star", "Standout"));
  if (STATUS[r.status]) t.append(el("span", "tag", STATUS[r.status]));
  if (r.off_market) t.append(el("span", "tag warn", `${r.off_market.why} (${day(r.off_market.checked)})`));
  if (r.sharers === "ok") t.append(el("span", "tag okshare", "Sharers OK"));
  if (r.sharers === "no") t.append(el("span", "tag warn", "No sharers"));
  const av = availText(r); if (av) t.append(el("span", "tag", `Move in ${av}`));
  return t.childNodes.length ? t : null;
}
function rowFor(r, i) {
  const tr = el("tr", "r" + (CLOSED.includes(r.status) ? " dim" : "") + (i === cursor ? " cur" : ""));
  tr.tabIndex = i === cursor || (cursor < 0 && i === 0) ? 0 : -1;
  tr.dataset.id = r.id; tr.dataset.i = i;
  tr.setAttribute("aria-expanded", String(openId === r.id));
  const td = (cls, ...kids) => { const c = el("td", cls); c.append(...kids.filter((k) => k != null)); tr.append(c); return c; };

  td("c-pic", thumb(r));
  const a = el("div", "addr");
  const fresh = lastVisit && addedTime(r) && addedTime(r).getTime() > lastVisit;
  if (fresh) { const d = el("span", "seen-dot"); d.title = "New since your last visit"; a.append(d); }
  a.append(r.title || "Untitled");
  const mm = el("div", "m-meta");
  mm.append(el("span", null, areaOf(r) === "Other" ? (r.area || "Area unknown") : areaOf(r)));
  if (r.beds || r.baths) mm.append(el("span", null, `${r.beds || "?"} bd ${r.baths || "?"} ba`));
  if (r.added) mm.append(el("span", null, added(r)));
  td("c-addr", a, mm, tagsFor(r));
  const ar = td("c-area", r.area || "—"); if (r.area && areaOf(r) !== r.area && areaOf(r) !== "Other") ar.title = `Grouped as ${areaOf(r)}`;
  if (r.rent) {
    const was = previous(r);
    const rc = td("c-rent n", el("span", "rent", gbp(r.rent)));
    if (was && was > r.rent) rc.append(el("span", "was", `was ${gbp(was)}`));
    const pp = r.rent / PEOPLE;
    const e = el("span", "each " + ppClass(pp), gbp(pp));
    td("c-each n", e, el("span", "each-l", " each"));
  } else { td("c-rent n", el("span", "was", "")); td("c-each n", el("span", "each-l", "Price unknown")); }
  td("c-beds n", String(r.beds || "—"));
  td("c-baths n", String(r.baths || "—"));
  if (r.station) {
    const s = td("c-stn " + (r.station.walk <= STANDOUT.walk ? "near" : "far"));
    s.append(el("span", "walk", String(r.station.walk)), el("span", "stn-name", `${r.station.name} (${r.station.kind})`));
    s.title = `${r.station.walk} min walk to ${r.station.name} (${r.station.kind})`;
  } else td("c-stn", el("span", "stn-name", "No station found"));
  td("c-added", r.added ? added(r) : "—");
  td("c-status", statusCell(r));
  const sb = el("button", "starbtn", stars.has(r.id) ? "★" : "☆"); sb.type = "button";
  sb.setAttribute("aria-pressed", String(stars.has(r.id))); sb.setAttribute("aria-label", `Star ${r.title} (just you)`);
  sb.onclick = (ev) => { ev.stopPropagation(); toggleStar(r.id); };
  td("c-star", sb);
  tr.onclick = (ev) => { if (ev.target.closest("a,button")) return; setCursor(i, false); toggleOpen(r.id); };
  return tr;
}

function spark(h) {
  // A small step line of one site's asking rent over time (only drawn when it changed).
  const pts = h.filter((x) => localDate(x[0]));
  if (pts.length < 2) return null;
  const W = 220, H = 44, t0 = localDate(pts[0][0]), t1 = Math.max(+today(), +localDate(pts[pts.length - 1][0]));
  const vals = pts.map((x) => x[1]), lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.15 || 50;
  const X = (d) => 4 + ((d - t0) / Math.max(1, t1 - t0)) * (W - 8);
  const Y = (v) => 6 + (1 - (v - (lo - pad)) / ((hi + pad) - (lo - pad))) * (H - 12);
  let d = "";
  pts.forEach((p, i) => {
    const x = X(localDate(p[0])), y = Y(p[1]);
    d += i ? ` H${x.toFixed(1)} V${y.toFixed(1)}` : `M${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  d += ` H${X(t1).toFixed(1)}`;
  const s = sv("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: "spark", role: "img", "aria-label": "Asking rent over time" });
  s.append(sv("path", { d, fill: "none", stroke: "currentColor", "stroke-width": 2 }));
  const last = pts[pts.length - 1];
  s.append(sv("circle", { cx: X(t1), cy: Y(last[1]), r: 3.5, fill: "currentColor" }));
  return s;
}

function detail(r) {
  const tr = el("tr", "x"); const td = el("td"); td.colSpan = 11; tr.append(td);
  const xp = el("div", "xp"); td.append(xp);
  const pic = el("div", "xp-pic"); pic.append(thumb(r, true)); xp.append(pic);

  const facts = el("div", "xp-facts");
  if (r.off_market) {
    const since = offDate(r);
    facts.append(el("p", "offwarn", `${r.off_market.why}` + (since ? `, first seen ${since.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : "") + ` (checked ${day(r.off_market.checked)})`));
  }
  facts.append(el("h3", null, "Details"));
  const dl = el("dl");
  const add = (k, v) => { if (v) dl.append(el("dt", null, k), el("dd", null, v)); };
  add("Area", r.area || "Unknown");
  add("Rent", r.rent ? `${gbp(r.rent)} a month, ${gbp(r.rent / PEOPLE)} each` : "Price unknown");
  add("Rooms", `${r.beds || "?"} bedrooms, ${r.baths || "?"} bathrooms`);
  if (r.station) add("Station", `${r.station.walk} min walk to ${r.station.name} (${r.station.kind})`);
  add("Move in", availText(r));
  add("Sharers", r.sharers === "ok" ? "Advert says sharers OK" : r.sharers === "no" ? "No sharers" : "Not stated");
  add("Added", r.added ? added(r) : "");
  add("Checked", r.checked ? `Live check ${day(r.checked)}` : "");
  add("Status", STATUS[r.status] || (standout(r) ? "Live, standout" : "Live"));
  if (r.ruled_out) add("Why", r.ruled_out);
  facts.append(dl); xp.append(facts);

  const right = el("div", "xp-links");
  const hist = history(r);
  const changed = [...hist.values()].some((h) => h.length > 1);
  const differ = new Set([...hist.values()].map((h) => h[h.length - 1][1])).size > 1;
  if (changed || differ) {
    right.append(el("h3", null, changed ? "Price history" : "Prices by site"));
    const ul = el("ul", "hist");
    let longest = null;
    for (const [s, h] of hist) {
      const li = el("li"); li.append(el("b", null, siteName(s) + ": "));
      h.forEach(([when, rent], i) => {
        if (i) li.append(" → ");
        const cls = i ? (rent < h[i - 1][1] ? "down" : "up") : null;
        li.append(el("span", cls, gbp(rent) + (when ? ` (${day(when)})` : "")));
      });
      ul.append(li);
      if (h.length > 1 && (!longest || h.length > longest.length)) longest = h;
    }
    right.append(ul);
    if (longest) { const sp = spark(longest); if (sp) { sp.style.color = longest[longest.length - 1][1] < longest[0][1] ? "var(--blue)" : "var(--ox)"; right.append(sp); } }
  }
  const { main, named, others } = linksOf(r);
  right.append(el("h3", null, "Adverts"));
  if (main) {
    const a = el("a", "open", `Open on ${named(main)} ↗`); a.href = main; a.target = "_blank"; a.rel = "noopener"; right.append(a);
  } else right.append(el("p", null, "No advert link."));
  if (others.length) {
    const p = el("p", "alsos"); p.append("Also on ");
    others.forEach((u, i) => { const a = el("a", null, named(u)); a.href = u; a.target = "_blank"; a.rel = "noopener"; p.append(i ? ", " : "", a); });
    right.append(p);
  }
  const acts = el("div", "mine-acts");
  const sb = el("button", "chip", stars.has(r.id) ? "★ Starred" : "☆ Star"); sb.type = "button"; sb.setAttribute("aria-pressed", String(stars.has(r.id)));
  sb.onclick = () => toggleStar(r.id);
  const hb = el("button", "chip", hidden.has(r.id) ? "Unhide" : "Hide"); hb.type = "button";
  hb.onclick = () => { hidden.has(r.id) ? hidden.delete(r.id) : hidden.add(r.id); store.set("hidden", [...hidden]); render(); };
  acts.append(sb, hb, el("small", null, "Stars and hides are saved on this device only."));
  right.append(acts);
  xp.append(right);
  return tr;
}

let current = [];
function renderRows() {
  const body = $("rows"); body.textContent = "";
  current = visible();
  if (cursor >= current.length) cursor = current.length - 1;
  const hid = showHidden ? 0 : hiddenInView();
  const tally = $("tally"); tally.textContent = "";
  tally.append(`${current.length} ${current.length === 1 ? "home" : "homes"}` + (chipsOn() ? " match your filters" : ""));
  if (hid || showHidden) {
    const b = el("button", "clear", showHidden ? "Hide the ones you hid" : `Show ${hid} you hid`); b.type = "button";
    b.onclick = () => { showHidden = !showHidden; render(); };
    tally.append(". ", b);
  }
  if (!current.length) {
    const tr = el("tr"); const td = el("td", "empty"); td.colSpan = 11;
    td.append(el("strong", null, view === "stars" ? "No stars yet" : "Nothing here"),
      view === "stars" ? "Open a home and press Star to keep it here (this device only)." : "Clear a filter or try another view.");
    tr.append(td); body.append(tr); $("moreWrap").textContent = ""; return;
  }
  current.slice(0, shown).forEach((r, i) => {
    body.append(rowFor(r, i));
    if (openId === r.id) body.append(detail(r));
  });
  const mw = $("moreWrap"); mw.textContent = "";
  if (current.length > shown) {
    const m = el("button", "more", `Show more (${current.length - shown} left)`); m.type = "button";
    m.onclick = () => { shown += PAGE; renderRows(); };
    mw.append(m);
  }
}

function toggleStar(id) {
  stars.has(id) ? stars.delete(id) : stars.add(id);
  store.set("stars", [...stars]); render();
}
function toggleOpen(id) { openId = openId === id ? null : id; renderRows(); focusCursor(); }
function setCursor(i, scroll = true) {
  cursor = Math.max(0, Math.min(i, current.length - 1));
  if (cursor >= shown) { shown = cursor + 1; renderRows(); }
  for (const tr of document.querySelectorAll("#rows tr.r")) {
    const on = +tr.dataset.i === cursor; tr.classList.toggle("cur", on); tr.tabIndex = on ? 0 : -1;
  }
  if (scroll) focusCursor();
}
function focusCursor() {
  const tr = document.querySelector(`#rows tr.r[data-i="${cursor}"]`);
  if (tr) { tr.focus({ preventScroll: true }); tr.scrollIntoView({ block: "nearest" }); }
}

// Jump to a home from the tape, KPI or cut feed: keep the view if it's there, else show Everything.
function jumpTo(id) {
  if (window.matchMedia("(max-width: 760px)").matches) setPane("board");
  let i = visible().findIndex((r) => r.id === id);
  if (i < 0) {
    view = "all"; query = ""; $("search").value = ""; Object.assign(chips, { areas: [], beds: 0, baths: 0, each: 0, walk: 0 });
    if (hidden.has(id)) showHidden = true;
    render(); i = current.findIndex((r) => r.id === id);
  }
  if (i < 0) return;
  openId = id; shown = Math.max(shown, i + 1); cursor = i; render();
  const tr = document.querySelector(`#rows tr.r[data-i="${i}"]`);
  if (tr) { tr.focus({ preventScroll: true }); tr.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }
}

// ---- Market numbers ----
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const liveRows = () => rows.filter((r) => inView(r, "active"));
function events() {
  const ev = [];
  for (const r of rows) {
    const t = addedTime(r);
    if (r.added) ev.push({ kind: "new", at: t ? +t : +localDate(r.added) + 12 * 36e5, id: r.id, r });
    for (const [s, h] of history(r)) {
      for (let i = 1; i < h.length; i++) {
        if (h[i][1] < h[i - 1][1] && localDate(h[i][0])) ev.push({ kind: "cut", at: +localDate(h[i][0]) + 12 * 36e5, id: r.id, r, from: h[i - 1][1], to: h[i][1], site: s });
      }
    }
    if (r.off_market && offDate(r)) ev.push({ kind: "off", at: +offDate(r) + 9 * 36e5, id: r.id, r, why: r.off_market.why });
  }
  return ev.sort((a, b) => b.at - a.at);
}
const whenText = (ms) => { const d = new Date(ms); const n = Math.round((today() - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5); return n <= 0 ? "today" : n === 1 ? "yesterday" : `${n}d ago`; };

function renderTape(ev) {
  const run = $("tapeRun"); run.textContent = "";
  const cutoff = +today() - 7 * 864e5;
  const recent = ev.filter((e) => e.at >= cutoff).slice(0, 40);
  if (!recent.length) { $("tape").hidden = true; return; }
  const make = (e, dup) => {
    const b = el("button", "tape-item t-" + e.kind); b.type = "button";
    if (dup) { b.tabIndex = -1; b.setAttribute("aria-hidden", "true"); }
    const r = e.r;
    const kind = e.kind === "new" ? "New" : e.kind === "cut" ? "Cut" : /let/i.test(e.why) ? "Let" : "Off";
    b.append(el("span", "t-kind", kind), el("span", "t-title", r.title));
    if (e.kind === "cut") b.append(el("span", "t-move", `${gbp(e.from)} → ${gbp(e.to)} (−${Math.round((1 - e.to / e.from) * 100)}%)`));
    else if (r.rent) b.append(el("span", null, `${gbp(r.rent)}`));
    b.append(el("span", "t-when", whenText(e.at)));
    b.onclick = () => jumpTo(e.id);
    return b;
  };
  recent.forEach((e) => run.append(make(e, false)));
  recent.forEach((e) => run.append(make(e, true)));
  run.style.setProperty("--tape-dur", `${Math.max(40, recent.length * 5)}s`);
}

function renderKpis() {
  const box = $("kpis"); box.textContent = "";
  const live = liveRows();
  const each = median(live.filter((r) => r.rent).map((r) => r.rent / PEOPLE));
  const wk = +today() - 6 * 864e5;
  const newWk = rows.filter((r) => { const t = addedTime(r); return (t ? +t : +localDate(r.added)) >= wk; }).length;
  const offWk = rows.filter((r) => r.off_market && +offDate(r) >= wk).length;
  const so = rows.filter(standout).length;
  const tile = (label, n, sub, go) => {
    const t = el(go ? "button" : "div", "kpi"); if (go) { t.type = "button"; t.onclick = go; }
    t.append(el("span", "kpi-l", label), el("span", "kpi-n", n));
    const s = el("span", "kpi-s"); if (typeof sub === "string") s.textContent = sub; else s.append(...sub);
    t.append(s); box.append(t);
  };
  const setView = (v) => () => { view = v; shown = PAGE; cursor = -1; store.set("view", v); if (matchMedia("(max-width: 760px)").matches) setPane("board"); render(); $("board").scrollIntoView({ block: "start" }); };
  tile("Live homes", String(live.length), `${rows.length} tracked in all`, setView("active"));
  tile("Standouts", String(so), "Meet every Standout rule", setView("standouts"));
  const diff = each != null ? Math.round(each - TARGET_PP) : 0;
  tile("Median rent each", each != null ? gbp(each) : "—",
    [el("span", ppClass(each || 0), diff === 0 ? "On target" : `${gbp(Math.abs(diff))} ${diff > 0 ? "over" : "under"} the £1,000 target`)]);
  tile("New in 7 days", String(newWk), "Homes added to the list");
  tile("Off market in 7 days", String(offWk), "Let or taken down", setView("gone"));
}

// ---- Charts (plain SVG) ----
const tip = $("tip");
function showTip(html, x, y) {
  tip.innerHTML = html; tip.hidden = false;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, x + 12)) + "px";
  tip.style.top = Math.max(8, y - h - 12) + "px";
}
const hideTip = () => { tip.hidden = true; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function bindTip(g, html) {
  g.addEventListener("pointermove", (e) => showTip(html, e.clientX, e.clientY));
  g.addEventListener("pointerleave", hideTip);
  g.addEventListener("focus", () => { const b = g.getBoundingClientRect(); showTip(html, b.left + b.width / 2, b.top); });
  g.addEventListener("blur", hideTip);
}

function chartArea() {
  const host = $("chArea"); host.textContent = "";
  const groups = {};
  for (const r of liveRows()) if (r.rent) (groups[areaOf(r)] ||= []).push(r.rent / PEOPLE);
  const data = Object.entries(groups).filter(([a, v]) => v.length >= 2 && a !== "Other" && a !== "Outside area")
    .map(([a, v]) => ({ a, m: median(v), n: v.length, lo: Math.min(...v), hi: Math.max(...v) })).sort((x, y) => x.m - y.m);
  if (!data.length) { host.append(el("p", "cap", "Not enough live homes yet.")); return; }
  // Dot = median rent each, line = cheapest to dearest live home in that area.
  const W = 320, L = 88, R = 64, row = 21, top = 6, H = top + data.length * row + 22;
  const lo = Math.min(700, Math.floor(Math.min(...data.map((d) => d.lo)) / 100) * 100);
  const hi = Math.min(2000, Math.max(1500, Math.ceil(Math.max(...data.map((d) => d.hi)) / 100) * 100));
  const kfmt = (v) => (v >= 1000 ? `£${+(v / 1000).toFixed(1)}k` : `£${v}`);
  const X = (v) => L + ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * (W - L - R);
  const s = sv("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Median rent each by area, live homes" });
  const base = H - 20;
  for (let v = Math.ceil(lo / 200) * 200; v <= hi; v += 200) {
    if (v === TARGET_PP || v === MAX_PP) continue;
    s.append(sv("line", { x1: X(v), x2: X(v), y1: top, y2: base, class: "gridl" }));
    s.append(sv("text", { x: X(v), y: H - 6, "text-anchor": "middle", class: "reflbl" }, kfmt(v)));
  }
  for (const [v, cls] of [[TARGET_PP, "ref"], [MAX_PP, "ref ceil"]]) {
    s.append(sv("line", { x1: X(v), x2: X(v), y1: top, y2: base, class: cls }));
    s.append(sv("text", { x: X(v), y: H - 6, "text-anchor": "middle", class: "reflbl strong" }, kfmt(v)));
  }
  s.append(sv("line", { x1: L, x2: W - R, y1: base, y2: base, class: "axis" }));
  data.forEach((d, i) => {
    const y = top + i * row;
    const g = sv("g", { class: "m" + (chips.areas.length === 1 && chips.areas[0] === d.a ? " sel" : ""), tabindex: 0, role: "button", "aria-label": `${d.a}: median ${gbp(d.m)} each from ${d.n} homes. Filter to ${d.a}` });
    g.append(sv("rect", { x: 0, y, width: W, height: row, class: "hit" }));
    g.append(sv("text", { x: L - 8, y: y + row / 2 + 4, "text-anchor": "end" }, d.a));
    const cy = y + row / 2;
    g.append(sv("line", { x1: X(d.lo), x2: X(d.hi), y1: cy, y2: cy, class: "range" }));
    g.append(sv("circle", { cx: X(d.m), cy, r: 4.5, class: "dot " + ppClass(d.m) }));
    g.append(sv("text", { x: W - 24, y: cy + 4, "text-anchor": "end", class: "lbl-v" }, gbp(d.m)));
    g.append(sv("text", { x: W, y: cy + 4, "text-anchor": "end", class: "reflbl" }, String(d.n)));
    bindTip(g, `<b>${esc(d.a)}</b><br>Median ${gbp(d.m)} each<br>${d.n} live homes, ${gbp(d.lo)}–${gbp(d.hi)}`);
    const pick = () => { chips.areas = chips.areas.length === 1 && chips.areas[0] === d.a ? [] : [d.a]; view = view === "stars" ? "active" : view; hideTip(); if (matchMedia("(max-width: 760px)").matches) setPane("board"); saveChips(); };
    g.addEventListener("click", pick);
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); pick(); } });
    s.append(g);
  });
  host.append(s);
}

function chartDaily() {
  const host = $("chDaily"); host.textContent = "";
  const N = 28, end = today(), days = [];
  for (let i = N - 1; i >= 0; i--) { const d = new Date(end); d.setDate(d.getDate() - i); days.push({ d, n: 0, k: d.toISOString().slice(0, 10) }); }
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const idx = new Map(days.map((x, i) => [key(x.d), i]));
  for (const r of rows) {
    const t = addedTime(r);
    const k = t ? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(t) : (r.added || "").slice(0, 10);
    if (idx.has(k)) days[idx.get(k)].n++;
  }
  const W = 320, H = 130, L = 26, B = 20, T = 10;
  const max = Math.max(4, ...days.map((x) => x.n));
  const nice = max <= 10 ? Math.ceil(max / 2) * 2 : Math.ceil(max / 10) * 10;
  const bw = (W - L) / N;
  const Y = (v) => T + (1 - v / nice) * (H - T - B);
  const s = sv("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Homes added per day over the last 28 days" });
  for (const v of [nice / 2, nice]) {
    s.append(sv("line", { x1: L, x2: W, y1: Y(v), y2: Y(v), class: "gridl" }));
    s.append(sv("text", { x: L - 5, y: Y(v) + 4, "text-anchor": "end" }, String(v)));
  }
  days.forEach((x, i) => {
    const g = sv("g", { class: "m", tabindex: 0, "aria-label": `${x.d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}: ${x.n} added` });
    const bx = L + i * bw;
    g.append(sv("rect", { x: bx, y: T, width: bw, height: H - T - B, class: "hit" }));
    if (x.n) {
      const h = Y(0) - Y(x.n), w = bw - 2, r = Math.min(3, w / 2, h);
      g.append(sv("path", { d: `M${bx + 1} ${Y(0)}v${-(h - r)}a${r} ${r} 0 0 1 ${r} ${-r}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - r}z`, class: "bar" }));
    }
    bindTip(g, `<b>${x.d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</b><br>${x.n} ${x.n === 1 ? "home" : "homes"} added`);
    s.append(g);
  });
  s.append(sv("line", { x1: L, x2: W, y1: Y(0), y2: Y(0), class: "axis" }));
  const lab = (i, anchor) => s.append(sv("text", { x: L + i * bw + bw / 2, y: H - 5, "text-anchor": anchor }, days[i].d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })));
  lab(0, "start"); lab(13, "middle"); lab(N - 1, "end");
  host.append(s);
  const tot = days.reduce((a, x) => a + x.n, 0);
  $("capDaily").textContent = `Last 28 days: ${tot} homes found, about ${(tot / 4).toFixed(0)} a week.`;
}

function chartLast() {
  const host = $("chLast"); host.textContent = "";
  const spans = rows.filter((r) => r.off_market && r.status === "gone" && localDate(r.added) && offDate(r))
    .map((r) => Math.max(0, Math.round((offDate(r) - localDate(r.added)) / 864e5)));
  if (!spans.length) { host.append(el("p", "cap", "No let homes yet.")); return; }
  const bins = [[0, 3, "0–3"], [4, 7, "4–7"], [8, 14, "8–14"], [15, 21, "15–21"], [22, 28, "22–28"], [29, 1e9, "29+"]]
    .map(([a, b, l]) => ({ l, a, b, n: spans.filter((d) => d >= a && d <= b).length }));
  const W = 320, H = 140, L = 26, B = 34, T = 14;
  const max = Math.max(...bins.map((x) => x.n));
  const nice = max <= 10 ? Math.ceil(max / 2) * 2 : Math.ceil(max / 20) * 20;
  const bw = (W - L) / bins.length;
  const Y = (v) => T + (1 - v / nice) * (H - T - B);
  const s = sv("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Homes by days on our list before let or taken down" });
  for (const v of [nice / 2, nice]) {
    s.append(sv("line", { x1: L, x2: W, y1: Y(v), y2: Y(v), class: "gridl" }));
    s.append(sv("text", { x: L - 5, y: Y(v) + 4, "text-anchor": "end" }, String(v)));
  }
  bins.forEach((x, i) => {
    const g = sv("g", { class: "m", tabindex: 0, "aria-label": `${x.l} days: ${x.n} homes` });
    const bx = L + i * bw;
    g.append(sv("rect", { x: bx, y: T, width: bw, height: H - T - B, class: "hit" }));
    if (x.n) {
      const h = Y(0) - Y(x.n), w = bw - 8, r = Math.min(4, h);
      g.append(sv("path", { d: `M${bx + 4} ${Y(0)}v${-(h - r)}a${r} ${r} 0 0 1 ${r} ${-r}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - r}z`, class: "bar" }));
      g.append(sv("text", { x: bx + bw / 2, y: Y(x.n) - 4, "text-anchor": "middle", class: "lbl-v" }, String(x.n)));
    }
    g.append(sv("text", { x: bx + bw / 2, y: H - B + 15, "text-anchor": "middle" }, x.l));
    bindTip(g, `<b>${x.l} days</b><br>${x.n} homes (${Math.round(x.n / spans.length * 100)}%)`);
    s.append(g);
  });
  s.append(sv("line", { x1: L, x2: W, y1: Y(0), y2: Y(0), class: "axis" }));
  s.append(sv("text", { x: L + (W - L) / 2, y: H - 3, "text-anchor": "middle", class: "reflbl" }, "days on our list"));
  host.append(s);
  const fast = spans.filter((d) => d <= 7).length;
  $("capLast").textContent = `${spans.length} homes let or taken down. Median ${median(spans)} days from when we found them; ${Math.round(fast / spans.length * 100)}% went within a week.`;
}

function renderCuts(ev) {
  const ol = $("cuts"); ol.textContent = "";
  const cuts = ev.filter((e) => e.kind === "cut").slice(0, 14);
  if (!cuts.length) { ol.append(el("li", "cap", "No price cuts yet.")); return; }
  for (const e of cuts) {
    const li = el("li"); const b = el("button"); b.type = "button";
    b.append(el("span", "c-t", e.r.title), el("span", "c-p", gbp(e.to)),
      el("span", "c-m", `${siteName(e.site)}, ${whenText(e.at)}, ${gbp(e.to / PEOPLE)} each` + (CLOSED.includes(e.r.status) ? ", now gone" : "")),
      el("span", "c-w", gbp(e.from)));
    b.setAttribute("aria-label", `${e.r.title}: cut from ${gbp(e.from)} to ${gbp(e.to)} on ${siteName(e.site)}`);
    b.onclick = () => jumpTo(e.id);
    li.append(b); ol.append(li);
  }
}

// ---- Render ----
function render() {
  renderViews(); renderChips(); renderSortUi(); renderRows();
  if (rows.length) chartArea();
}

// ---- Wiring ----
function setPane(p) {
  document.body.dataset.pane = p;
  for (const b of document.querySelectorAll(".phone-switch button")) b.setAttribute("aria-pressed", String(b.dataset.pane === p));
}
document.body.dataset.pane = "board";
for (const b of document.querySelectorAll(".phone-switch button")) b.onclick = () => setPane(b.dataset.pane);

$("search").addEventListener("input", (e) => { query = e.target.value.trim().toLowerCase(); shown = PAGE; cursor = -1; render(); });
$("sortSel").addEventListener("change", (e) => { const [key, dir] = e.target.value.split(":"); sort = { key, dir }; store.set("sort", sort); render(); });
for (const b of document.querySelectorAll(".grid thead button[data-sort]")) {
  b.onclick = () => {
    const k = b.dataset.sort;
    sort = sort.key === k ? { key: k, dir: sort.dir === "asc" ? "desc" : "asc" } : { key: k, dir: ["added", "beds", "baths"].includes(k) ? "desc" : "asc" };
    store.set("sort", sort); render();
  };
}
function toggler(btnId, panelId) {
  const b = $(btnId), p = $(panelId);
  b.onclick = () => { p.hidden = !p.hidden; b.setAttribute("aria-expanded", String(!p.hidden)); };
}
toggler("howBtn", "how"); toggler("keysBtn", "keys");

document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const typing = e.target.closest("input, select, textarea");
  if (e.key === "Escape") {
    if (typing) { e.target.blur(); return; }
    document.querySelectorAll(".areapick[open]").forEach((d) => (d.open = false));
    if (openId) { openId = null; renderRows(); focusCursor(); }
    hideTip(); return;
  }
  if (typing) return;
  if (e.key === "/") { e.preventDefault(); $("search").focus(); return; }
  if (!current.length) return;
  const onRow = e.target.closest && e.target.closest("tr.r");
  if (e.key === "j" || (onRow && e.key === "ArrowDown")) { e.preventDefault(); setCursor(cursor + 1); }
  else if (e.key === "k" || (onRow && e.key === "ArrowUp")) { e.preventDefault(); setCursor(cursor < 0 ? 0 : cursor - 1); }
  else if (e.key === "Enter" && (onRow || e.target === document.body)) { e.preventDefault(); if (cursor < 0) setCursor(0); toggleOpen(current[cursor].id); }
  else if (e.key === "o" && cursor >= 0) { const { main } = linksOf(current[cursor]); if (main) window.open(main, "_blank", "noopener"); }
  else if (e.key === "s" && cursor >= 0) { const id = current[cursor].id; toggleStar(id); }
});
document.addEventListener("focusin", (e) => { const tr = e.target.closest && e.target.closest("#rows tr.r"); if (tr && +tr.dataset.i !== cursor) setCursor(+tr.dataset.i, false); });
document.addEventListener("click", (e) => { for (const d of document.querySelectorAll(".areapick[open]")) if (!d.contains(e.target)) d.open = false; });

fetch("../../data/listings.json", { cache: "no-cache" })
  .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then((data) => {
    rows = data; byId = new Map(rows.map((r) => [r.id, r]));
    const latest = rows.reduce((m, r) => ((r.added_at || r.added || "") > m ? (r.added_at || r.added) : m), "");
    const lr = rows.find((r) => (r.added_at || r.added) === latest);
    $("stamp").textContent = lr ? `Latest home added ${added(lr)}` : "";
    $("foot").textContent = `${rows.length} homes tracked. Rent is the advertised monthly total; each is split four ways (blue up to £1,000, amber up to £1,200, red above). Always check the advert itself. Stars and hides are kept in this browser only.`;
    const ev = events();
    renderKpis(); renderTape(ev); chartDaily(); chartLast(); renderCuts(ev);
    render();
  })
  .catch((err) => {
    console.error(err);
    $("rows").innerHTML = '<tr><td colspan="11" class="empty"><strong>Couldn\'t load the listings</strong>Reload the page to try again.</td></tr>';
  });

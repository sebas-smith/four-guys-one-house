// Four Guys One House, option A: "The Sunday property supplement".
// Rules (STANDOUT, views, price history, link choice) are ported unchanged from the root app.js.
"use strict";

const STATUS = { no: "Ruled out", gone: "Gone / let" };
const CLOSED = ["no", "gone"];
const TARGET_PP = 1000, MAX_PP = 1200, PEOPLE = 4, PAGE = 60;
// Rough monthly bills per person: council tax, energy, water and broadband split four ways. An estimate, not from adverts.
const BILLS_PP = 120;
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
const TABS = [["standouts", "Standouts"], ["active", "Active"], ["budget", "In budget"], ["gone", "Gone"], ["all", "Everything"]];
const KEY = "fgoh-a-";
const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(KEY + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch {} },
};

let rows = [], byId = new Map();
let filter = store.get("filter", "standouts"), sort = store.get("sort", "newest"), query = "", shown = PAGE;
let compare = store.get("compare", []);
if (!TABS.some(([k]) => k === filter)) filter = "standouts";
if (!["newest", "cheapest"].includes(sort)) sort = "newest";
if (!Array.isArray(compare)) compare = [];

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
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

const isOpen = (r) => !CLOSED.includes(r.status) && r.sharers !== "no";
function inView(r, f) {
  if (f === "active") return isOpen(r);
  if (f === "standouts") return standout(r);
  if (f === "budget") return isOpen(r) && r.rent && r.rent <= MAX_PP * PEOPLE;
  if (f === "all") return true;
  return r.status === f;
}
const matchesQuery = (r) => !query || `${r.title} ${r.area}`.toLowerCase().includes(query);
const matches = (r, f = filter) => matchesQuery(r) && inView(r, f);
function visible() {
  const by = {
    newest: (a, b) => (b.added_at || b.added || "").localeCompare(a.added_at || a.added || ""),
    cheapest: (a, b) => (a.rent || 9e9) - (b.rent || 9e9),
  }[sort];
  return rows.filter((r) => matches(r)).sort(by);
}

// ---------- shared bits of a listing ----------
const ppClass = (pp) => (pp <= TARGET_PP ? "good" : pp <= MAX_PP ? "warn" : "bad");
const avail = (r) => {
  const a = (r.available || "").replace(/^(availability date|available( from)?)\s*:?\s*/i, "");
  return a ? (/^\d{4}-\d\d-\d\d$/.test(a) ? day(a) : a) : "";
};
const stationText = (s) => `${s.walk} min walk to ${s.name} (${s.kind})`;
const NUM = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const word = (n) => NUM[n] || String(n);

function linkInfo(r) {
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
function linksEl(r) {
  const { main, named, others } = linkInfo(r);
  const box = el("div", "links");
  if (main) {
    const a = el("a", "open", `Open on ${named(main)}`); a.href = main; a.target = "_blank"; a.rel = "noopener";
    box.append(a);
  }
  if (others.length) {
    const alt = el("span", "alt", "Also on ");
    others.forEach((u, i) => {
      const a = el("a", null, named(u)); a.href = u; a.target = "_blank"; a.rel = "noopener";
      alt.append(i ? ", " : "", a);
    });
    box.append(alt);
  }
  return box;
}
function history(r) {
  const hist = new Map([...bySite(r)].map(([s, h]) => [s, h.filter((x, i) => !i || x[1] !== h[i - 1][1])]));
  const changed = [...hist.values()].some((h) => h.length > 1);
  const differ = new Set([...hist.values()].map((h) => h[h.length - 1][1])).size > 1;
  return { hist, label: changed ? "Price history" : differ ? "Prices by site" : "" };
}
const histLine = (where, h) => `${siteName(where)}: ` + h.map(([when, rent]) => `${gbp(rent)}${when ? " (" + day(when) + ")" : ""}`).join(" → ");
function historyEl(r) {
  const { hist, label } = history(r);
  if (!label) return null;
  const d = el("details", "hist");
  d.append(el("summary", null, label));
  for (const [where, h] of hist) d.append(el("p", null, histLine(where, h)));
  return d;
}
function photoEl(r, cls) {
  const fig = el("figure", cls);
  const pic = safe(r.photo);
  const fallback = () => {
    fig.textContent = "";
    fig.classList.add("nophoto");
    const plate = el("div", "plate");
    plate.append(el("span", "plate-beds", r.beds ? String(r.beds) : "?"), el("span", "plate-cap", r.beds ? "bedrooms" : "beds unknown"));
    plate.append(el("span", "plate-note", "No photo in the advert"));
    fig.append(plate);
  };
  if (pic) {
    const img = el("img"); img.src = pic; img.alt = `Photo of ${r.title}`; img.loading = "lazy"; img.referrerPolicy = "no-referrer";
    img.onerror = fallback;
    fig.append(img);
  } else fallback();
  return fig;
}
function priceEl(r, big) {
  const box = el("div", "price" + (big ? " price-big" : ""));
  if (!r.rent) { box.append(el("p", "pp", "Price unknown")); return box; }
  const pp = r.rent / PEOPLE;
  const line = el("p", "rent");
  line.append(el("span", "rent-n", gbp(r.rent)), el("span", "rent-u", " a month"));
  box.append(line);
  const was = previous(r);
  if (was && was > r.rent) { const w = el("p", "was"); w.append("was ", el("s", null, gbp(was))); box.append(w); }
  const p = el("p", "pp " + ppClass(pp));
  p.append(el("b", null, gbp(pp)), " each");
  box.append(p);
  const t = el("p", "true");
  t.append(`About ${gbp(pp + BILLS_PP)} each with bills`);
  const star = el("a", "est", "*"); star.href = "#bills"; star.title = "Bills are a rough estimate"; star.setAttribute("aria-label", "Bills are an estimate, see note");
  t.append(star);
  box.append(t);
  return box;
}
function flags(r) {
  const out = [];
  if (standout(r)) out.push(["star", "Standout"]);
  if (placeholder(r)) out.push(["pending", "Details pending"]);
  if (STATUS[r.status]) out.push(["closed", STATUS[r.status]]);
  if (r.off_market) out.push(["warn", `${r.off_market.why} (${day(r.off_market.checked)})`]);
  if (r.sharers === "no") out.push(["warn", "No sharers"]);
  if (r.sharers === "ok") out.push(["ok", "Sharers OK"]);
  return out;
}
function flagsEl(r) {
  const f = flags(r);
  if (!f.length) return null;
  const box = el("p", "flags");
  for (const [k, t] of f) box.append(el("span", "flag flag-" + k, t));
  return box;
}
function factsEl(r) {
  const ul = el("ul", "facts");
  if (r.station) ul.append(el("li", r.station.walk <= STANDOUT.walk ? "near" : null, stationText(r.station)));
  const a = avail(r);
  if (a) ul.append(el("li", null, `Available ${a}`));
  if (r.added) ul.append(el("li", "added", `Added ${added(r)}`));
  return ul;
}
const kicker = (r) => [r.area, r.beds && `${r.beds} bed`, r.baths && `${r.baths} bath`].filter(Boolean).join(", ");

function compareBtn(r) {
  const on = compare.includes(r.id);
  const b = el("button", "cmp", on ? "In compare" : "Compare"); b.type = "button";
  b.setAttribute("aria-pressed", String(on));
  b.dataset.id = r.id;
  b.onclick = () => toggleCompare(r.id);
  return b;
}

// One listing in the grid. kind: "photo" | "wide" | "text".
function ad(r, kind) {
  const a = el("article", `ad ad-${kind}` + (CLOSED.includes(r.status) ? " closed" : ""));
  a.id = "h-" + r.id;
  if (kind !== "text") a.append(photoEl(r, "ad-pic"));
  const body = el("div", "ad-body");
  body.append(el("p", "kick", kicker(r)));
  body.append(el("h3", "ad-title", r.title));
  const fl = flagsEl(r); if (fl) body.append(fl);
  body.append(priceEl(r, kind === "wide"));
  body.append(factsEl(r));
  const foot = el("div", "ad-foot");
  foot.append(linksEl(r), compareBtn(r));
  body.append(foot);
  const h = historyEl(r); if (h) body.append(h);
  a.append(body);
  return a;
}

// ---------- the lead story ----------
function pickLead() {
  const pool = rows.filter(standout);
  const fallback = rows.filter((r) => isOpen(r) && !r.off_market && r.rent && r.rent <= MAX_PP * PEOPLE && r.beds >= 4 && !placeholder(r));
  const list = pool.length ? pool : fallback;
  const score = (r) => (safe(r.photo) ? 0 : 1000) + (r.station ? r.station.walk : 30) * 10 + r.rent / 100 - (r.baths || 0) * 5;
  return { r: [...list].sort((a, b) => score(a) - score(b))[0], isStandout: pool.length > 0 };
}
function standfirst(r) {
  const pp = r.rent / PEOPLE;
  const kind = /flat|apartment|maisonette/i.test(r.title) ? "flat" : "home";
  let s = `A ${word(r.beds)}-bed, ${word(r.baths)}-bath ${kind} in ${r.area || "the search area"}`;
  if (r.station) s += `, ${word(r.station.walk)} minute${r.station.walk === 1 ? "" : "s"} on foot from ${r.station.name}`;
  s += `. At ${gbp(r.rent)} a month it works out at ${gbp(pp)} each, `;
  s += pp <= TARGET_PP ? "inside our £1,000 target." : pp <= MAX_PP ? `${gbp(pp - TARGET_PP)} over target but within our £1,200 limit.` : "over our £1,200 limit.";
  const was = previous(r);
  if (was && was > r.rent) s += ` The agent has already cut it from ${gbp(was)}.`;
  const a = avail(r);
  if (a && !/unavailable|let agreed/i.test(a)) s += ` Available ${/^(now|today)$/i.test(a) ? "now" : a}.`;
  if (r.checked) s += ` Checked live ${daysAgo(r.checked) === 0 ? "today" : daysAgo(r.checked) === 1 ? "yesterday" : day(r.checked)}.`;
  return s;
}
function renderLead() {
  const box = $("lead"); box.textContent = "";
  const { r, isStandout } = pickLead();
  box.hidden = !r || !!query;
  if (!r) return null;
  const fig = photoEl(r, "lead-photo");
  const txt = el("div", "lead-text");
  txt.append(el("p", "lead-label", isStandout ? "This issue's best standout" : "No standouts today: the best home in budget"));
  txt.append(el("h2", "lead-title", r.title));
  txt.append(el("p", "standfirst", standfirst(r)));
  const fl = flagsEl(r); if (fl) txt.append(fl);
  txt.append(priceEl(r, true));
  txt.append(factsEl(r));
  const foot = el("div", "ad-foot"); foot.append(linksEl(r), compareBtn(r));
  txt.append(foot);
  const h = historyEl(r); if (h) txt.append(h);
  box.append(fig, txt);
  return r;
}

// ---------- this week ----------
function digest() {
  const wk = (iso) => daysAgo(iso) <= 6;
  const newer = rows.filter((r) => isOpen(r) && wk(r.added)).sort((a, b) => (b.added_at || b.added).localeCompare(a.added_at || a.added));
  const cuts = rows.filter((r) => isOpen(r) && previous(r)).sort((a, b) => (previous(b) - b.rent) - (previous(a) - a.rent));
  const gone = rows.filter((r) => r.status === "gone" && goneDate(r) && wk(goneDate(r)))
    .sort((a, b) => goneDate(b).localeCompare(goneDate(a)));
  return { newer, cuts, gone };
}
// The day a home first went: the earliest dated "let agreed / taken down / marked gone" note, as YYYY-MM-DD.
// off_market.checked can't be used because every recheck moves it to today.
const MON = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
function goneDate(r) {
  if ("_gone" in r) return r._gone;
  r._gone = null;
  for (const n of r.notes || []) {
    const m = /(?:marked gone|let agreed|taken down|withdrawn|retracted).*?\((\d{4}-\d\d-\d\d|\d{1,2} [A-Z][a-z]{2})\)/i.exec(n);
    if (!m) continue;
    if (/^\d{4}/.test(m[1])) r._gone = m[1];
    else {
      const [d, mo] = m[1].split(" "), now = new Date();
      let y = now.getFullYear();
      if (MON[mo] && new Date(y, MON[mo] - 1, +d) > now) y -= 1;
      r._gone = MON[mo] ? `${y}-${String(MON[mo]).padStart(2, "0")}-${d.padStart(2, "0")}` : null;
    }
    break;
  }
  return r._gone;
}
function renderDigest() {
  const box = $("digest-body"); box.textContent = "";
  const { newer, cuts, gone } = digest();
  const sec = (title, list, line, empty) => {
    const s = el("section", "dg");
    const h = el("h3", "dg-h"); h.append(title, el("span", "dg-n", String(list.length)));
    s.append(h);
    if (!list.length) { s.append(el("p", "dg-empty", empty)); box.append(s); return; }
    const ol = el("ul", "dg-list");
    list.slice(0, 6).forEach((r) => {
      const li = el("li");
      const b = el("button", "dg-item"); b.type = "button";
      b.append(el("span", "dg-t", r.title), el("span", "dg-m", line(r)));
      b.onclick = () => openHome(r.id);
      li.append(b); ol.append(li);
    });
    s.append(ol);
    if (list.length > 6) s.append(el("p", "dg-more", `and ${list.length - 6} more`));
    box.append(s);
  };
  sec("New this week", newer, (r) => `${r.area || "Area unknown"}, ${r.rent ? gbp(r.rent) : "price unknown"}. Added ${day(r.added)}`, "Nothing new in the last seven days.");
  sec("Price cuts", cuts, (r) => `${gbp(previous(r))} down to ${gbp(r.rent)}, ${gbp(r.rent / PEOPLE)} each`, "No live home has cut its rent.");
  sec("Let or taken down", gone, (r) => `${r.area || "Area unknown"}, ${r.rent ? gbp(r.rent) : "price unknown"}. Went ${day(goneDate(r))}`, "Nothing went this week.");
  $("digest-sum").textContent = `${newer.length} new, ${cuts.length} price cuts, ${gone.length} gone`;
}

// ---------- nav and grid ----------
function renderTabs() {
  const bar = $("tabs"); bar.textContent = "";
  for (const [k, label] of TABS) {
    const n = rows.filter((r) => matches(r, k)).length;
    const b = el("button", "tab", label); b.type = "button"; b.setAttribute("aria-pressed", String(filter === k));
    b.append(el("span", "n", String(n)));
    b.onclick = () => { filter = k; shown = PAGE; store.set("filter", k); render(); };
    bar.append(b);
  }
}
const VIEW_DEK = {
  standouts: "Live, up to £4,100, two or more bathrooms, eight minutes or less to a station, checked in the last three days.",
  active: "Every live home that takes sharers.",
  budget: "Live homes at £4,800 or less: £1,200 each at most.",
  gone: "Let or taken down. Kept for the record and for price comparisons.",
  all: "Every home we have tracked, including ruled out and gone.",
};
// Packs listings into rows without reordering: two photos side by side, a photo with a text listing,
// or up to three text listings. Every fourth single photo becomes a wide feature.
function pack(items) {
  const out = []; let i = 0, singles = 0;
  const hasPic = (r) => !!safe(r.photo);
  while (i < items.length) {
    const a = items[i], b = items[i + 1];
    if (hasPic(a)) {
      if (b && hasPic(b)) { out.push(["pp", [a, b]]); i += 2; continue; }
      if (singles++ % 4 === 0 || !b) { out.push(["w", [a]]); i += 1; continue; }
      out.push(["pt", [a, b]]); i += 2; continue;
    }
    const run = [a]; let j = i + 1;
    while (run.length < 3 && items[j] && !hasPic(items[j])) run.push(items[j++]);
    if (run.length < 3 && items[j] && hasPic(items[j]) && run.length === 1) { out.push(["tp", [a, items[j]]]); i = j + 1; continue; }
    out.push(["t" + run.length, run]); i = j;
  }
  return out;
}
function render() {
  renderTabs();
  const lead = query ? null : (renderLead() || null);
  if (query) $("lead").hidden = true;
  const list = $("grid"); list.textContent = "";
  let items = visible();
  const label = TABS.find(([k]) => k === filter)[1];
  const total = items.length;
  if (lead && filter === "standouts") items = items.filter((r) => r !== lead);
  $("view-h").textContent = query ? `${label} matching "${query}"` : label;
  $("view-dek").textContent = `${total} ${total === 1 ? "home" : "homes"}` + (lead && filter === "standouts" && total ? ", the lead story among them" : "") + ". " + VIEW_DEK[filter];
  if (!items.length) {
    const e = el("div", "empty");
    e.append(el("p", "empty-h", total ? "That's all of them" : "Nothing here"),
      el("p", null, total ? "The only home in this view is the lead story above." : query ? "No street or area matches that search in this view. Try another spelling or switch to Everything." : "Try another view."));
    list.append(e); return;
  }
  for (const [kind, group] of pack(items.slice(0, shown))) {
    const row = el("div", "row row-" + kind);
    if (kind === "w") row.append(ad(group[0], "wide"));
    else for (const r of group) row.append(ad(r, safe(r.photo) ? "photo" : "text"));
    list.append(row);
  }
  if (items.length > shown) {
    const more = el("button", "more", `Show ${Math.min(PAGE, items.length - shown)} more of ${items.length - shown}`); more.type = "button";
    more.onclick = () => { shown += PAGE; render(); };
    list.append(more);
  }
}

// ---------- dialog: one home ----------
function openHome(id) {
  const r = byId.get(id); if (!r) return;
  const dlg = $("home-dlg"), body = $("home-body"); body.textContent = "";
  body.append(ad(r, "wide"));
  body.querySelector(".ad").removeAttribute("id");
  dlg.showModal();
}

// ---------- compare ----------
function toggleCompare(id) {
  const i = compare.indexOf(id);
  if (i >= 0) compare.splice(i, 1);
  else {
    if (compare.length >= 3) { flash("Compare holds three homes. Remove one first."); return; }
    compare.push(id);
  }
  store.set("compare", compare);
  document.querySelectorAll(`.cmp[data-id="${CSS.escape(id)}"]`).forEach((b) => {
    const on = compare.includes(id); b.textContent = on ? "In compare" : "Compare"; b.setAttribute("aria-pressed", String(on));
  });
  renderTray();
  if ($("cmp-dlg").open) renderCompare();
}
function flash(msg) {
  const t = $("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(flash.t); flash.t = setTimeout(() => { t.hidden = true; }, 2600);
}
function renderTray() {
  compare = compare.filter((id) => byId.has(id));
  const tray = $("tray");
  tray.hidden = !compare.length;
  $("tray-n").textContent = `Comparing ${compare.length} of 3`;
}
function renderCompare() {
  const box = $("cmp-body"); box.textContent = "";
  const homes = compare.map((id) => byId.get(id)).filter(Boolean);
  if (!homes.length) { box.append(el("p", "empty-h", "Nothing to compare yet"), el("p", null, "Press Compare on up to three homes.")); return; }
  const table = el("table", "cmp-table");
  const head = el("tr"); head.append(el("th", "rowh", ""));
  homes.forEach((r) => {
    const th = el("th"); th.scope = "col";
    th.append(photoEl(r, "cmp-photo"), el("span", "cmp-title", r.title));
    const x = el("button", "cmp-x", "Remove"); x.type = "button"; x.onclick = () => toggleCompare(r.id);
    th.append(x);
    head.append(th);
  });
  const thead = el("thead"); thead.append(head); table.append(thead);
  const tb = el("tbody");
  const cheapest = Math.min(...homes.map((r) => r.rent || 9e9));
  const nearest = Math.min(...homes.map((r) => (r.station ? r.station.walk : 99)));
  const line = (label, fn) => {
    const tr = el("tr"); const th = el("th", "rowh", label); th.scope = "row"; tr.append(th);
    homes.forEach((r) => { const td = el("td"); const v = fn(r, td); if (v != null) td.append(v); tr.append(td); });
    tb.append(tr);
  };
  line("Rent", (r, td) => { if (r.rent === cheapest && homes.length > 1) td.className = "best"; return r.rent ? gbp(r.rent) : "Unknown"; });
  line("Each", (r, td) => { if (r.rent) td.className = "pp " + ppClass(r.rent / PEOPLE); return r.rent ? gbp(r.rent / PEOPLE) : "Unknown"; });
  line("Each with bills*", (r) => (r.rent ? `About ${gbp(r.rent / PEOPLE + BILLS_PP)}` : "Unknown"));
  line("Beds", (r) => (r.beds ? String(r.beds) : "Unknown"));
  line("Baths", (r) => (r.baths ? String(r.baths) : "Unknown"));
  line("Walk", (r, td) => { if (r.station && r.station.walk === nearest && homes.length > 1) td.className = "best"; return r.station ? `${r.station.walk} min` : "Unknown"; });
  line("Station", (r) => (r.station ? `${r.station.name} (${r.station.kind})` : "Unknown"));
  line("Area", (r) => r.area || "Unknown");
  line("Available", (r) => avail(r) || "Not stated");
  line("Status", (r) => flags(r).map((f) => f[1]).join(". ") || "Live");
  line("Price history", (r) => {
    const { hist } = history(r);
    if (!hist.size) return "None recorded";
    const f = document.createDocumentFragment();
    for (const [w, h] of hist) f.append(el("span", "cmp-hist", histLine(w, h)));
    return f;
  });
  line("Added", (r) => added(r));
  line("Advert", (r) => linksEl(r));
  table.append(tb);
  const wrap = el("div", "cmp-scroll"); wrap.append(table);
  box.append(wrap);
}

// ---------- boot ----------
function masthead() {
  const now = new Date();
  const first = rows.reduce((m, r) => (r.added && r.added < m ? r.added : m), "9999");
  const issue = Number.isFinite(daysAgo(first)) ? daysAgo(first) + 1 : 1;
  const part = (o) => now.toLocaleDateString("en-GB", o);
  const date = `${part({ weekday: "long" })} ${part({ day: "numeric" })} ${part({ month: "long" })} ${part({ year: "numeric" })}`;
  const live = rows.filter(isOpen).length;
  $("issue").textContent = `No. ${issue}`;
  $("issue-date").textContent = date;
  $("issue-live").textContent = `${live} homes live of ${rows.length} tracked`;
  const latest = rows.reduce((m, r) => ((r.added_at || r.added) > m ? (r.added_at || r.added) : m), "");
  const lr = rows.find((r) => (r.added_at || r.added) === latest);
  $("foot-latest").textContent = lr ? `Latest addition: ${lr.title}, ${added(lr)}.` : "";
}

$("search").addEventListener("input", (e) => { query = e.target.value.trim().toLowerCase(); shown = PAGE; render(); });
const sortSel = $("sort"); sortSel.value = sort;
sortSel.addEventListener("change", () => { sort = sortSel.value; store.set("sort", sort); shown = PAGE; render(); });
$("tray-view").onclick = () => { renderCompare(); $("cmp-dlg").showModal(); };
$("tray-clear").onclick = () => { const ids = [...compare]; ids.forEach(toggleCompare); };
document.querySelectorAll("dialog").forEach((d) => {
  d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
  d.querySelector(".dlg-close").onclick = () => d.close();
});

fetch("../../data/listings.json", { cache: "no-cache" })
  .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then((data) => {
    rows = data; byId = new Map(rows.map((r) => [r.id, r]));
    try { if (!matchMedia("(min-width: 1040px)").matches) $("digest-box").open = false; } catch {}
    masthead(); renderDigest(); renderTray(); render();
    document.body.classList.add("ready");
  })
  .catch(() => {
    $("grid").innerHTML = '<div class="empty"><p class="empty-h">The listings didn\'t load</p><p>Check your connection and reload the page.</p></div>';
  });

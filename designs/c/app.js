// House Hunt (design c): a swipe deck over the same data and rules as the root app.js.
// Read-only for shared data; kept / passed / last visit live in this browser only.

// ---------- rules copied from the root app.js ----------
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
  return m ? [m[1].toLowerCase()] : [];
}
const open = (r) => !CLOSED.includes(r.status) && r.sharers !== "no";
function inView(r, v) {
  if (v === "active") return open(r);
  if (v === "standouts") return standout(r);
  if (v === "budget") return open(r) && r.rent && r.rent <= MAX_PP * PEOPLE;
  if (v === "all") return true;
  return r.status === v;
}
const SORTS = {
  newest: (a, b) => (b.added_at || b.added || "").localeCompare(a.added_at || a.added || ""),
  cheapest: (a, b) => (a.rent || 9e9) - (b.rent || 9e9),
  walk: (a, b) => ((a.station ? a.station.walk : 999) - (b.station ? b.station.walk : 999)) || (a.rent || 9e9) - (b.rent || 9e9),
};

// ---------- the main link choice (same as root) ----------
function linkSet(r) {
  const links = (r.links || []).map(safe).filter(Boolean);
  const dead = deadSites(r), rank = ["rightmove", "onthemarket"];
  const isDead = (u) => dead.includes(site(u).toLowerCase()) || dead.includes(siteKey(u));
  const ok = links.filter((u) => !isDead(u));
  const cur = atRent(r);
  const main = [...ok].sort((a, b) => (cur.includes(siteKey(b)) - cur.includes(siteKey(a))) ||
    ((rank.indexOf(siteKey(a)) + 1 || 9) - (rank.indexOf(siteKey(b)) + 1 || 9)))[0] || safe(r.url) || links[0];
  const total = {}, nth = new Map();
  for (const u of links) { total[site(u)] = (total[site(u)] || 0) + 1; nth.set(u, total[site(u)]); }
  const named = (u) => site(u) + (total[site(u)] > 1 ? ` ${nth.get(u)}` : "");
  return { main, named, isDead, others: links.filter((u) => u !== main) };
}

// ---------- personal storage ----------
const KEY = "fgoh-c-";
const load = (k, d) => { try { const v = localStorage.getItem(KEY + k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch {} };

let rows = [], byId = new Map();
let kept = load("kept", []);            // ids, newest kept first
let passed = new Set(load("passed", []));
let deckView = load("deckView", "standouts");
let allView = load("allView", "standouts");
let sort = load("sort", "newest");
let unit = load("unit", "month");
let tab = load("tab", "deck");
let deckNew = false, allNew = false, query = "", shown = PAGE;
let undoStack = [], front = null, sharedIds = null;
if (!VIEWS.some(([k]) => k === deckView)) deckView = "standouts";
if (!VIEWS.some(([k]) => k === allView)) allView = "standouts";
if (!SORTS[sort]) sort = "newest";
if (!Array.isArray(kept)) kept = [];

// Last visit: the time before this session started. Reloads in the same session keep the same mark.
let since = null, firstVisit = false;
try {
  const s = sessionStorage.getItem(KEY + "since");
  if (s) { since = +s; firstVisit = sessionStorage.getItem(KEY + "first") === "1"; }
  else {
    const last = localStorage.getItem(KEY + "last");
    since = last ? +last : null;
    if (!since) { firstVisit = true; since = Date.now() - 2 * 864e5; }
    sessionStorage.setItem(KEY + "since", String(since));
    sessionStorage.setItem(KEY + "first", firstVisit ? "1" : "0");
  }
  localStorage.setItem(KEY + "last", String(Date.now()));
} catch { since = Date.now() - 2 * 864e5; firstVisit = true; }
const addedMs = (r) => { const t = addedTime(r); if (t) return +t; const d = localDate(r.added); return d ? +d : 0; };
const isNew = (r) => addedMs(r) > since;
const sinceText = () => firstVisit ? "in the last 2 days" : "since " + new Date(since).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
const SVG = {
  train: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="3" width="12" height="13" rx="3"/><path d="M6 11h12M9 20l-2 2M15 20l2 2M9 16v.01M15 16v.01"/></svg>',
  bed: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18V7M3 13h18v5M21 13a3 3 0 0 0-3-3h-7v3"/><circle cx="7" cy="10.5" r="1.5"/></svg>',
  bath: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16v3a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4zM6 12V6a2 2 0 0 1 4 0"/></svg>',
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  ext: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
};
const withIcon = (icon, text) => { const s = el("span"); s.innerHTML = SVG[icon]; s.append(text); return s; };
const district = (r) => { const m = /\b(SW\d{1,2}|W\d{1,2}|SE\d{1,2}|TW\d{1,2}|KT\d{1,2}|CR\d)\b/i.exec(`${r.title} ${(r.links || []).join(" ")}`); return m ? m[1].toUpperCase() : (r.area || "?").slice(0, 3); };
const POSTER = ["#2338e6", "#d21f4b", "#e8640c", "#5a2a8c", "#1b2560", "#0f6c8f"];
const posterColour = (r) => { let h = 0; for (const c of r.area || r.title) h = (h * 31 + c.charCodeAt(0)) >>> 0; return POSTER[h % POSTER.length]; };
const ppClass = (pp) => pp <= TARGET_PP ? "good" : pp <= MAX_PP ? "warn" : "bad";
const ppValue = (rent) => unit === "week" ? rent * 12 / 52 / PEOPLE : rent / PEOPLE;
const ppLabel = () => unit === "week" ? "each a week" : "each a month";
const availText = (r) => { const a = (r.available || "").replace(/^(availability date|available( from)?)\s*:?\s*/i, ""); return a ? (/^\d{4}-\d\d-\d\d$/.test(a) ? day(a) : a) : ""; };
const keptSet = () => new Set(kept);

function plate(r) {
  const p = el("div", "plate");
  if (!r.rent) { p.classList.add("unknown"); p.append(el("b", null, "Price unknown")); return p; }
  p.classList.add(ppClass(r.rent / PEOPLE));
  p.append(el("b", null, gbp(ppValue(r.rent))), el("small", null, ppLabel()));
  return p;
}
function totalLine(r) {
  const t = el("div", "total");
  if (!r.rent) return t;
  t.append(el("b", null, gbp(r.rent)), " a month");
  const was = previous(r);
  if (was && was > r.rent) t.append(el("s", null, `was ${gbp(was)}`));
  return t;
}
function tagsFor(r, cls) {
  const out = [], k = keptSet();
  const t = (c, s) => out.push(el("span", `${cls} ${c}`, s));
  if (standout(r)) t("star", "Standout");
  if (isNew(r)) t("new", "New");
  if (placeholder(r)) t("dim", "Details pending");
  if (STATUS[r.status]) t("dim", STATUS[r.status]);
  if (r.off_market) t("warn", `${r.off_market.why} (${day(r.off_market.checked)})`);
  if (r.sharers === "ok") t("", "Sharers OK");
  if (r.sharers === "no") t("warn", "No sharers");
  if (cls === "tag" && k.has(r.id)) t("kept", "Kept");
  if (cls === "tag" && passed.has(r.id)) t("passed", "Passed");
  return out;
}
function posterEl(r, cls) {
  const p = el("div", cls); p.style.setProperty("--pc", posterColour(r));
  return p;
}
function photoOr(r, holder, onFail) {
  const pic = safe(r.photo);
  if (!pic) { onFail(); return; }
  const img = el("img", "photo"); img.alt = ""; img.referrerPolicy = "no-referrer"; img.decoding = "async"; img.draggable = false;
  img.onerror = () => { img.remove(); onFail(); };
  img.src = pic;
  holder.append(img);
}

// ---------- deck ----------
function deckItems() {
  const k = keptSet();
  const items = rows.filter((r) => inView(r, deckView) && !k.has(r.id) && !passed.has(r.id) && (!deckNew || isNew(r))).sort(SORTS[sort]);
  if (front) { const i = items.findIndex((r) => r.id === front); if (i > 0) items.unshift(items.splice(i, 1)[0]); }
  return items;
}

function cardEl(r, depth) {
  const c = el("article", "card" + (depth === 0 ? " top" : depth === 1 ? " behind" : " behind2"));
  c.dataset.id = r.id;
  if (depth === 0) { c.tabIndex = 0; c.setAttribute("aria-label", `${r.title}. Swipe right to keep, left to pass, or press Space for details.`); }
  const bg = posterEl(r, "poster");
  c.append(bg);
  photoOr(r, c, () => {
    bg.append(el("div", "bars"), el("div", "pc-big", district(r)), el("div", "nophoto", "No photo yet"));
  });
  const top = el("div", "card-top"); top.append(...tagsFor(r, "pill"));
  const body = el("div", "card-body");
  body.append(el("h2", null, r.title), el("p", "area", r.area || ""));
  const pl = el("div", "priceline"); pl.append(plate(r), totalLine(r)); body.append(pl);
  const facts = el("div", "facts");
  if (r.beds) facts.append(withIcon("bed", `${r.beds} bed`));
  if (r.baths) facts.append(withIcon("bath", `${r.baths} bath`));
  if (r.station) { const s = withIcon("train", `${r.station.walk} min walk to ${r.station.name} (${r.station.kind})`); if (r.station.walk <= STANDOUT.walk) s.classList.add("near-mark"); facts.append(s); }
  const av = availText(r); if (av) facts.append(el("span", null, `Available ${av}`));
  if (r.added) facts.append(withIcon("clock", `Added ${added(r)}`));
  body.append(facts);
  c.append(top, body, el("div", "stamp keep", "Keep"), el("div", "stamp pass", "Pass"));
  return c;
}

function renderDeckChips() {
  const bar = $("deckViews"); bar.textContent = "";
  const k = keptSet();
  const left = (v) => rows.filter((r) => inView(r, v) && !k.has(r.id) && !passed.has(r.id) && (!deckNew || isNew(r))).length;
  for (const [v, label] of VIEWS) {
    const b = el("button", "chip", label); b.type = "button"; b.setAttribute("aria-pressed", String(deckView === v));
    b.append(el("span", "n", left(v)));
    b.onclick = () => { deckView = v; front = null; save("deckView", v); renderDeck(); };
    bar.append(b);
  }
  const nn = rows.filter((r) => inView(r, deckView) && !k.has(r.id) && !passed.has(r.id) && isNew(r)).length;
  const nb = el("button", "chip chip-new", "New"); nb.type = "button"; nb.setAttribute("aria-pressed", String(deckNew));
  nb.title = `Added ${sinceText()}`;
  nb.append(el("span", "n", nn));
  nb.onclick = () => { deckNew = !deckNew; renderDeck(); };
  bar.prepend(nb);
}

function renderDeck() {
  renderDeckChips();
  const stage = $("stage"); stage.textContent = "";
  const items = deckItems();
  const viewName = VIEWS.find(([k]) => k === deckView)[1];
  $("undo").disabled = !undoStack.length;
  const has = items.length > 0;
  $("pass").disabled = $("keep").disabled = $("more").disabled = !has;
  if (!has) {
    const e = el("div", "deck-empty");
    const total = rows.filter((r) => inView(r, deckView)).length;
    e.append(el("h2", null, total ? "All swiped" : "Nothing here"),
      el("p", null, total ? `You've been through every home in ${viewName}${deckNew ? " added " + sinceText() : ""}. Pick another set above, or see what you kept.` : `No homes in ${viewName} right now. Try Active or Everything.`));
    const b = el("button", "btn btn-solid", "See what you kept"); b.type = "button"; b.onclick = () => setTab("kept");
    if (kept.length) e.append(b);
    stage.append(e);
  } else {
    items.slice(0, 3).reverse().forEach((r, i, a) => stage.append(cardEl(r, a.length - 1 - i)));
    attachDrag(stage.lastElementChild);
  }
  updateBadges();
}

function attachDrag(card) {
  let x0 = 0, y0 = 0, dx = 0, dy = 0, t0 = 0, down = false, id = null;
  const stampK = card.querySelector(".stamp.keep"), stampP = card.querySelector(".stamp.pass");
  const paint = () => {
    card.style.transform = `translate(${dx}px, ${dy * 0.25}px) rotate(${dx / 18}deg)`;
    stampK.style.opacity = Math.max(0, Math.min(1, dx / 110));
    stampP.style.opacity = Math.max(0, Math.min(1, -dx / 110));
  };
  card.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    down = true; id = e.pointerId; x0 = e.clientX; y0 = e.clientY; dx = dy = 0; t0 = performance.now();
    card.classList.remove("settle"); card.classList.add("dragging");
  });
  card.addEventListener("pointermove", (e) => {
    if (!down || e.pointerId !== id) return;
    dx = e.clientX - x0; dy = e.clientY - y0;
    if (Math.abs(dx) > 6 && !card.hasPointerCapture(id)) { try { card.setPointerCapture(id); } catch {} }
    if (Math.abs(dx) > 6) paint();
  });
  const end = (e) => {
    if (!down || e.pointerId !== id) return;
    down = false; card.classList.remove("dragging");
    const v = Math.abs(dx) / Math.max(1, performance.now() - t0);
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6 && e.type === "pointerup") { openSheet(byId.get(card.dataset.id), card); return; }
    if (Math.abs(dx) > 110 || (v > 0.6 && Math.abs(dx) > 40)) { swipe(dx > 0 ? "keep" : "pass"); return; }
    dx = dy = 0; card.classList.add("settle"); paint();
  };
  card.addEventListener("pointerup", end);
  card.addEventListener("pointercancel", end);
}

let flying = false;
function swipe(action) {
  const card = $("stage").querySelector(".card.top");
  if (!card || flying) return;
  flying = true;
  const id = card.dataset.id;
  const dir = action === "keep" ? 1 : -1;
  card.classList.remove("dragging", "settle"); card.classList.add("fly");
  card.querySelector(`.stamp.${action}`).style.opacity = 1;
  card.style.transform = `translate(${dir * (window.innerWidth + 200)}px, 40px) rotate(${dir * 28}deg)`;
  const behind = $("stage").querySelector(".card.behind");
  if (behind) { behind.style.transition = "transform .38s, filter .38s"; behind.style.transform = "none"; behind.style.filter = "none"; }
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  setTimeout(() => { flying = false; mark(id, action, true); renderDeck(); focusTop(); }, reduce ? 0 : 330);
}
const focusTop = () => { const t = $("stage").querySelector(".card.top"); if (t && document.activeElement && document.activeElement.closest && document.activeElement.closest("#stage")) t.focus(); };

// Record keep / pass / clear for one home. Undo restores the previous state.
function mark(id, action, fromDeck) {
  const prev = kept.includes(id) ? "keep" : passed.has(id) ? "pass" : null;
  if (prev === action) return;
  undoStack.push({ id, prev, fromDeck });
  if (undoStack.length > 50) undoStack.shift();
  setState(id, action);
  if (front === id) front = null;
  const r = byId.get(id);
  toast(action === "keep" ? `Kept ${r.title}` : action === "pass" ? `Passed ${r.title}` : prev === "keep" ? `Removed ${r.title} from Kept` : `${r.title} is back in the deck`, true);
}
function setState(id, state) {
  kept = kept.filter((x) => x !== id); passed.delete(id);
  if (state === "keep") kept.unshift(id);
  if (state === "pass") passed.add(id);
  save("kept", kept); save("passed", [...passed]);
}
function undo() {
  const u = undoStack.pop();
  if (!u) return;
  setState(u.id, u.prev);
  if (u.fromDeck) front = u.id;
  toast(`Undone: ${byId.get(u.id).title} is back`);
  renderAllPanes();
}

// ---------- list rows ----------
function rowEl(r) {
  const b = el("button", "row" + (CLOSED.includes(r.status) ? " dim" : "")); b.type = "button";
  b.onclick = () => openSheet(r, b);
  const th = el("div", "thumb"); th.style.setProperty("--pc", posterColour(r));
  const pic = safe(r.photo);
  if (pic) {
    const img = el("img"); img.alt = ""; img.loading = "lazy"; img.referrerPolicy = "no-referrer"; img.src = pic;
    img.onerror = () => { img.remove(); th.append(el("span", "pc", district(r))); };
    th.append(img);
  } else th.append(el("span", "pc", district(r)));
  const m = el("div", "row-main");
  m.append(el("h3", null, r.title));
  m.append(el("div", "row-meta", [r.area, r.beds && `${r.beds} bed`, r.baths && `${r.baths} bath`].filter(Boolean).join(", ")));
  if (r.station) { const s = el("div", "row-meta"); s.append(el("span", r.station.walk <= STANDOUT.walk ? "near" : null, `${r.station.walk} min walk to ${r.station.name} (${r.station.kind})`)); m.append(s); }
  const av = availText(r);
  m.append(el("div", "row-meta", `Added ${added(r)}${av ? `. Available ${av}` : ""}`));
  const tg = el("div", "row-tags"); tg.append(...tagsFor(r, "tag")); if (tg.childElementCount) m.append(tg);
  const p = el("div", "row-price");
  if (r.rent) {
    p.append(el("span", "pp " + ppClass(r.rent / PEOPLE), gbp(ppValue(r.rent))), el("small", null, ppLabel()), el("span", "tot", gbp(r.rent)));
    const was = previous(r); if (was && was > r.rent) p.append(el("s", null, `was ${gbp(was)}`));
  } else p.append(el("small", null, "Price unknown"));
  b.append(th, m, p);
  return b;
}

function renderAll() {
  const bar = $("allViews"); bar.textContent = "";
  for (const [v, label] of VIEWS) {
    const b = el("button", "chip", label); b.type = "button"; b.setAttribute("aria-pressed", String(allView === v));
    b.append(el("span", "n", rows.filter((r) => inView(r, v) && (!query || `${r.title} ${r.area}`.toLowerCase().includes(query))).length));
    b.onclick = () => { allView = v; shown = PAGE; save("allView", v); renderAll(); };
    bar.append(b);
  }
  $("newOnlyLabel").textContent = `Only new ${sinceText()}`;
  const items = rows.filter((r) => inView(r, allView) && (!query || `${r.title} ${r.area}`.toLowerCase().includes(query)) && (!allNew || isNew(r))).sort(SORTS[sort]);
  $("allSub").textContent = `${items.length} ${items.length === 1 ? "home" : "homes"} in ${VIEWS.find(([k]) => k === allView)[1]}${allNew ? ", new only" : ""}. Tap one for details.`;
  const list = $("allList"); list.textContent = "";
  if (!items.length) {
    const e = el("div", "empty"); e.append(el("strong", null, "Nothing here"), "Try another filter, or clear the search."); list.append(e); return;
  }
  items.slice(0, shown).forEach((r) => list.append(rowEl(r)));
  if (items.length > shown) {
    const more = el("button", "more-btn", `Show more (${items.length - shown} left)`); more.type = "button";
    more.onclick = () => { shown += PAGE; renderAll(); };
    list.append(more);
  }
}

function renderKept() {
  const ids = sharedIds || kept;
  const items = ids.map((id) => byId.get(id)).filter(Boolean);
  $("kept").querySelector("h1").textContent = sharedIds ? "Shared shortlist" : "Kept";
  $("kept").querySelector(".pane-sub").textContent = sharedIds
    ? "Someone's shortlist, opened from a link. It doesn't change your own Kept list."
    : "Your shortlist. Saved in this browser only.";
  $("shareKept").hidden = !!sharedIds || !kept.length;
  $("clearPassed").hidden = !!sharedIds || !passed.size;
  $("clearPassed").textContent = `Bring back ${passed.size} passed ${passed.size === 1 ? "home" : "homes"}`;
  const st = $("keptStats"); st.textContent = "";
  const live = items.filter((r) => open(r) && !r.off_market);
  if (items.length) {
    const cheapest = live.filter((r) => r.rent).sort(SORTS.cheapest)[0];
    const nearest = live.filter((r) => r.station).sort(SORTS.walk)[0];
    const stat = (b, s) => { const d = el("div", "stat"); d.append(el("b", null, b), el("span", null, s)); st.append(d); };
    stat(`${live.length}/${items.length}`, "still on the market");
    stat(cheapest ? gbp(ppValue(cheapest.rent)) : "–", `cheapest ${ppLabel()}`);
    stat(nearest ? `${nearest.station.walk} min` : "–", "shortest walk");
  }
  const list = $("keptList"); list.textContent = "";
  if (!items.length) {
    const e = el("div", "empty");
    e.append(el("strong", null, sharedIds ? "No homes in this link" : "Nothing kept yet"),
      sharedIds ? "The homes in this link aren't on the list any more." : "Swipe right on a home in the Deck, or press Keep, and it lands here.");
    list.append(e); return;
  }
  items.forEach((r) => list.append(rowEl(r)));
}

function updateBadges() {
  const k = keptSet();
  const n = rows.filter((r) => open(r) && isNew(r) && !k.has(r.id) && !passed.has(r.id)).length;
  $("badgeDeck").hidden = !n; $("badgeDeck").textContent = n;
  $("badgeKept").hidden = !kept.length; $("badgeKept").textContent = kept.length;
}

function renderAllPanes() { renderDeck(); renderKept(); renderAll(); }

// ---------- details sheet ----------
let sheetReturn = null, sheetId = null;
function spark(r) {
  const hist = new Map([...bySite(r)].map(([s, h]) => [s, h.filter((x, i) => !i || x[1] !== h[i - 1][1])]));
  const pts = [...bySite(r).values()].flat();
  if (!pts.length) return null;
  const changed = [...hist.values()].some((h) => h.length > 1);
  const differ = new Set([...hist.values()].map((h) => h[h.length - 1][1])).size > 1;
  const wrap = el("div", "hist");
  if (changed || differ) {
    const t = (x) => (localDate(x[0]) || new Date()).getTime();
    const ts = pts.map(t), ps = pts.map((x) => x[1]);
    const tMin = Math.min(...ts), tMax = Math.max(...ts, Date.now()), pMin = Math.min(...ps), pMax = Math.max(...ps);
    const W = 300, H = 64, X = (v) => 6 + (W - 12) * ((v - tMin) / Math.max(1, tMax - tMin)), Y = (v) => 8 + (H - 16) * (1 - (v - pMin) / Math.max(1, pMax - pMin));
    const colours = ["var(--cobalt)", "var(--tang)", "var(--rose)", "var(--muted)"];
    let svg = `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Price history chart">`;
    [...bySite(r)].forEach(([, h], i) => {
      const c = colours[i % colours.length];
      const p = h.map((x) => [X(t(x)), Y(x[1])]);
      p.push([X(Date.now()), p[p.length - 1][1]]); // carry the latest price to today
      const d = p.map(([x, y], j) => (j ? `H${x.toFixed(1)}V${y.toFixed(1)}` : `M${x.toFixed(1)} ${y.toFixed(1)}`)).join("");
      svg += `<path d="${d}" stroke="${c}" fill="none" vector-effect="non-scaling-stroke"/>`;
      p.slice(0, -1).forEach(([x, y]) => { svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="${c}" stroke="none"/>`; });
    });
    wrap.innerHTML = svg + "</svg>";
  }
  for (const [where, h] of hist) wrap.append(el("p", null, `${siteName(where)}: ` + h.map(([when, rent]) => `${gbp(rent)}${when ? " (" + day(when) + ")" : ""}`).join(" → ")));
  return { node: wrap, label: changed ? "Price history" : differ ? "Prices by site" : "Price" };
}

function openSheet(r, from) {
  if (!r) return;
  sheetReturn = from || document.activeElement; sheetId = r.id;
  const s = $("sheet"); s.textContent = "";
  const hero = el("div", "sheet-hero"); hero.style.setProperty("--pc", posterColour(r));
  photoOr(r, hero, () => hero.append(el("span", "pc", district(r))));
  const close = el("button", "sheet-close"); close.type = "button"; close.setAttribute("aria-label", "Close"); close.innerHTML = SVG.x; close.onclick = closeSheet;
  hero.append(el("span", "sheet-grab"), close);
  const b = el("div", "sheet-body");
  const h = el("h2", null, r.title); h.id = "sheetTitle";
  b.append(h, el("p", "sub", r.area || ""));
  const tg = el("div", "tags"); tg.append(...tagsFor(r, "tag")); if (tg.childElementCount) b.append(tg);
  const money = el("div", "money"); money.append(plate(r), totalLine(r)); b.append(money);
  if (r.off_market) b.append(el("div", "warnbox", `${r.off_market.why} (checked ${day(r.off_market.checked)}). Check the advert before you get excited.`));
  const g = el("div", "grid2");
  const cell = (label, val, cls) => { const c = el("div", "cell" + (cls ? " " + cls : "")); c.append(el("span", null, label), el("b", null, val)); g.append(c); };
  cell("Bedrooms", r.beds ? String(r.beds) : "?"); cell("Bathrooms", r.baths ? String(r.baths) : "?");
  if (r.station) cell(`Walk to ${r.station.name} (${r.station.kind})`, `${r.station.walk} min`, r.station.walk <= STANDOUT.walk ? "near" : "");
  cell("Added", added(r));
  const av = availText(r); if (av) cell("Available", av);
  if (r.checked) cell("Advert last checked", day(r.checked));
  if (r.rent) cell(unit === "week" ? "Each a month" : "Each a week", gbp(unit === "week" ? r.rent / PEOPLE : r.rent * 12 / 52 / PEOPLE));
  b.append(g);
  const sp = spark(r);
  if (sp) { b.append(el("h3", null, sp.label), sp.node); }
  const L = linkSet(r);
  if (L.main || L.others.length) {
    b.append(el("h3", null, "Adverts"));
    const ls = el("div", "links");
    if (L.main) { const a = el("a", "open-main"); a.href = L.main; a.target = "_blank"; a.rel = "noopener"; a.append(`Open on ${L.named(L.main)}`); a.insertAdjacentHTML("beforeend", SVG.ext); ls.append(a); }
    if (L.others.length) {
      const alt = el("div", "open-alt");
      for (const u of L.others) { const a = el("a", L.isDead(u) ? "dead" : null, L.named(u)); a.href = u; a.target = "_blank"; a.rel = "noopener"; if (L.isDead(u)) a.title = "Let or taken down on this site"; alt.append(a); }
      ls.append(el("p", "row-meta", "Also on"), alt);
    }
    b.append(ls);
  }
  s.append(hero, b);
  {
    const acts = el("div", "sheet-actions");
    const isKept = kept.includes(r.id), isPassed = passed.has(r.id);
    const pass = el("button", "ctl ctl-pass"); pass.type = "button"; pass.innerHTML = SVG.x; pass.append(isPassed ? "Unpass" : "Pass");
    pass.onclick = () => { mark(r.id, isPassed ? null : "pass", false); closeSheet(); renderAllPanes(); };
    const keep = el("button", "ctl ctl-keep"); keep.type = "button"; keep.innerHTML = SVG.heart; keep.append(isKept ? "Remove from Kept" : "Keep");
    keep.onclick = () => { mark(r.id, isKept ? null : "keep", false); closeSheet(); renderAllPanes(); };
    acts.append(pass, keep);
    s.append(acts);
  }
  $("sheetWrap").hidden = false;
  s.scrollTop = 0; s.focus();
}
function closeSheet() {
  if ($("sheetWrap").hidden) return;
  $("sheetWrap").hidden = true; sheetId = null;
  if (sheetReturn && document.contains(sheetReturn)) sheetReturn.focus();
}
$("scrim").onclick = closeSheet;
$("sheet").addEventListener("keydown", (e) => {
  if (e.key === "Escape") { e.preventDefault(); closeSheet(); }
  if (e.key === "Tab") {
    const f = [...$("sheet").querySelectorAll("button, a[href]")];
    if (!f.length) return;
    if (e.shiftKey && (document.activeElement === f[0] || document.activeElement === $("sheet"))) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  }
});

// ---------- toast ----------
let toastTimer;
function toast(msg, withUndo) {
  const t = $("toast"); t.textContent = msg;
  if (withUndo) { const u = el("button", null, "Undo"); u.type = "button"; u.onclick = undo; t.append(u); }
  t.classList.add("show"); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

// ---------- tabs, controls, keys ----------
const desktop = matchMedia("(min-width: 960px)");
function setTab(t) {
  tab = t; save("tab", t);
  document.body.dataset.tab = t;
  for (const b of document.querySelectorAll(".tabbar button")) {
    const on = b.dataset.tab === t || (desktop.matches && t === "deck" && b.dataset.tab === "all");
    if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  }
  const pane = $(t); if (pane && pane.classList.contains("pane-side")) pane.scrollTop = 0;
}
for (const b of document.querySelectorAll(".tabbar button")) b.onclick = () => setTab(b.dataset.tab);
desktop.addEventListener("change", () => setTab(tab === "deck" && desktop.matches ? "all" : tab));

function setUnit(u) {
  unit = u; save("unit", u);
  for (const b of document.querySelectorAll(".unit button")) b.setAttribute("aria-pressed", String(b.dataset.unit === u));
  if (rows.length) renderAllPanes();
  if (sheetId) openSheet(byId.get(sheetId), sheetReturn);
}
for (const b of document.querySelectorAll(".unit button")) b.onclick = () => setUnit(b.dataset.unit);

$("keep").onclick = () => swipe("keep");
$("pass").onclick = () => swipe("pass");
$("undo").onclick = undo;
$("more").onclick = () => { const c = $("stage").querySelector(".card.top"); if (c) openSheet(byId.get(c.dataset.id), $("more")); };
$("search").addEventListener("input", (e) => { query = e.target.value.trim().toLowerCase(); shown = PAGE; renderAll(); });
$("sort").value = sort;
$("sort").onchange = (e) => { sort = e.target.value; save("sort", sort); front = null; renderDeck(); renderAll(); };
$("newOnly").onchange = (e) => { allNew = e.target.checked; shown = PAGE; renderAll(); };
$("clearPassed").onclick = () => { const n = passed.size; passed.clear(); save("passed", []); undoStack = undoStack.filter((u) => u.prev !== "pass"); toast(`${n} passed ${n === 1 ? "home is" : "homes are"} back in the deck`); renderAllPanes(); };
$("resetAll").onclick = () => {
  if (!confirm("Clear every home you kept or passed in this browser?")) return;
  kept = []; passed.clear(); undoStack = []; save("kept", []); save("passed", []); toast("Cleared"); renderAllPanes();
};
$("shareKept").onclick = async () => {
  const url = location.href.split("#")[0] + "#k=" + kept.map(encodeURIComponent).join(",");
  let ok = false;
  try {
    await Promise.race([navigator.clipboard.writeText(url), new Promise((_, no) => setTimeout(() => no(new Error("timeout")), 1500))]);
    ok = true;
  } catch {}
  if (!ok) {
    const i = el("input"); i.value = url; document.body.append(i); i.select();
    try { ok = document.execCommand("copy"); } catch {}
    i.remove();
  }
  if (!ok) history.replaceState(null, "", url);
  toast(ok ? `Link to your ${kept.length} kept ${kept.length === 1 ? "home" : "homes"} copied` : "Couldn't copy. The link is now in the address bar: copy it from there.");
};

document.addEventListener("keydown", (e) => {
  if (!$("sheetWrap").hidden || e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = (e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "select" || tag === "textarea") return;
  const deckShown = tab === "deck" || desktop.matches;
  if (!deckShown) return;
  const onControl = tag === "button" || tag === "a";
  if (e.key === "ArrowRight") { e.preventDefault(); swipe("keep"); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); swipe("pass"); }
  else if (e.key === "z" || e.key === "Z" || (e.key === "Backspace" && !onControl)) { e.preventDefault(); undo(); }
  else if ((e.key === " " || e.key === "Enter") && !onControl) { const c = $("stage").querySelector(".card.top"); if (c) { e.preventDefault(); openSheet(byId.get(c.dataset.id), c); } }
});

// ---------- shared shortlist from the URL hash ----------
function readHash() {
  const m = /^#k=(.*)$/.exec(location.hash);
  sharedIds = m ? m[1].split(",").filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } }) : null;
  const box = $("shared"); box.textContent = "";
  box.hidden = !sharedIds;
  if (!sharedIds) return;
  const fresh = sharedIds.filter((id) => byId.has(id) && !kept.includes(id));
  const found = sharedIds.filter((id) => byId.has(id)).length;
  box.append(el("p", null, `You're looking at a shortlist someone shared: ${found} ${found === 1 ? "home" : "homes"}.`));
  if (fresh.length) {
    const add = el("button", null, `Add ${fresh.length} to my Kept`); add.type = "button";
    add.onclick = () => { kept = [...fresh, ...kept]; save("kept", kept); toast(`Added ${fresh.length} to your Kept`); closeShared(); };
    box.append(add);
  }
  const x = el("button", "ghost", "Close"); x.type = "button"; x.onclick = closeShared; box.append(x);
}
function closeShared() { history.replaceState(null, "", location.pathname + location.search); readHash(); renderAllPanes(); }
window.addEventListener("hashchange", () => { readHash(); renderAllPanes(); if (sharedIds) setTab("kept"); });

// ---------- start ----------
setUnit(unit);
setTab(desktop.matches && tab === "deck" ? "deck" : tab);
fetch("../../data/listings.json", { cache: "no-cache" })
  .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then((data) => {
    rows = data; byId = new Map(rows.map((r) => [r.id, r]));
    const latest = rows.reduce((m, r) => (r.added > m ? r.added : m), "");
    $("foot").textContent = `${rows.length} homes tracked. Latest addition ${day(latest)}. Rent is the advertised monthly total; per person is split four ways. Always check the advert itself.`;
    readHash();
    if (sharedIds) setTab("kept");
    renderAllPanes();
  })
  .catch(() => {
    const msg = '<div class="deck-empty"><h2>Couldn\'t load the homes</h2><p>Reload the page to try again.</p></div>';
    $("stage").innerHTML = msg;
  });

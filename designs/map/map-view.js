/* Four Guys One House: map module (window.FGOHMap).
 *
 * HOW TO EMBED IN A DESIGN
 * 1. In <head>:  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
 *                <link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css">  (optional)
 *                <link rel="stylesheet" href="../map/map-view.css">
 * 2. Before </body>: <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
 *                <script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js"></script>  (optional: pins cluster when it's there)
 *                <script src="../map/map-view.js"></script>
 * 3. Give a container a height, then:  const m = FGOHMap.mount(document.getElementById("map"), { homes: myFilteredList });
 *    m.setHomes(list) after your filters change; m.select(id) to open a home; m.on("select", (home) => ...) when a pin is tapped
 *    (home is null when the card closes); await m.ready; m.fitArea(); m.setTheme("auto" | "light" | "dark"); m.destroy().
 * 4. Restyle with CSS custom properties on .fgm (light) and .fgm.fgm--dark (dark): --fgm-good, --fgm-warn, --fgm-bad, --fgm-star,
 *    --fgm-ink, --fgm-surface, --fgm-font and the rest listed at the top of map-view.css.
 * Options: data: { listings, stations, lines, workplaces } URLs (default "../../data/<name>.json"); homes (array; omit to load
 * every listing); theme ("auto"); showGone (false); isStandout(home) to replace the built-in Standout rule.
 */
(function () {
  "use strict";

  // ---- Rules, the same as the root app.js --------------------------------------------------------
  const CLOSED = ["no", "gone"];
  const TARGET_PP = 1000, MAX_PP = 1200, PEOPLE = 4;
  const STANDOUT = { rent: 4100, beds: 4, baths: 2, walk: 8, checked: 3 };
  const placeholder = (r) => /^[a-z]+ listing \d+$/i.test(r.title || "");
  function localDate(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ""); return m ? new Date(+m[1], m[2] - 1, +m[3]) : null; }
  function daysAgo(iso) {
    const d = localDate(iso), now = new Date();
    return d ? Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - d) / 864e5) : Infinity;
  }
  const standoutRule = (r) => !CLOSED.includes(r.status) && !r.off_market && r.rent && r.rent <= STANDOUT.rent && r.beds >= STANDOUT.beds &&
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
  const gbp = (n) => "£" + Math.round(n).toLocaleString("en-GB");
  const safe = (u) => { try { return new URL(u).protocol === "https:" ? u : null; } catch { return null; } };
  function siteKey(url) {
    try { const p = new URL(url).hostname.replace(/^www\./, "").split("."); return p.find((x) => SITE[x]) || p[0]; } catch { return ""; }
  }
  const site = (url) => SITE[siteKey(url)] || siteKey(url) || "listing";
  const priced = (r) => (r.prices || []).filter((x) => x[2] && x[2] !== "search");
  function bySite(r) { const m = new Map(); for (const x of priced(r)) { if (!m.has(x[2])) m.set(x[2], []); m.get(x[2]).push(x); } return m; }
  const atRent = (r) => [...bySite(r)].filter(([, h]) => h[h.length - 1][1] === r.rent).map(([s]) => s);
  function previous(r) {
    const was = atRent(r).flatMap((s) => bySite(r).get(s).map((x) => x[1])).filter((p) => p > r.rent);
    return was.length ? Math.max(...was) : null;
  }
  function deadSites(r) { const m = r.off_market && /on (.+?)(,|$)/.exec(r.off_market.why || ""); return m ? [m[1]] : []; }
  // Main advert (Rightmove/OnTheMarket at the current price first) and the rest, numbered on repeats: as app.js.
  function adverts(r) {
    const links = (r.links || []).map(safe).filter(Boolean);
    const dead = deadSites(r), rank = ["rightmove", "onthemarket"], cur = atRent(r);
    const ok = links.filter((u) => !dead.includes(site(u)));
    const main = [...ok].sort((a, b) => (cur.includes(siteKey(b)) - cur.includes(siteKey(a))) ||
      ((rank.indexOf(siteKey(a)) + 1 || 9) - (rank.indexOf(siteKey(b)) + 1 || 9)))[0] || safe(r.url) || links[0];
    const total = {}, nth = new Map();
    for (const u of links) { total[site(u)] = (total[site(u)] || 0) + 1; nth.set(u, total[site(u)]); }
    const named = (u) => site(u) + (total[site(u)] > 1 ? ` ${nth.get(u)}` : "");
    return { main, others: links.filter((u) => u !== main), named };
  }
  const fit = (r) => !r.rent ? "none" : r.rent / PEOPLE <= TARGET_PP ? "good" : r.rent / PEOPLE <= MAX_PP ? "warn" : "bad";

  // ---- Map furniture ---------------------------------------------------------------------------
  // The drawn search area: POINTS in scripts/search_area.py.
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
  // Legend groups for lines.json kinds.
  const GROUPS = [
    ["tube", "Tube", ["Tube"]], ["overground", "Overground", ["Overground"]], ["elizabeth", "Elizabeth line", ["Elizabeth"]],
    ["rail", "National Rail", ["Rail"]], ["tramdlr", "Tram and DLR", ["Tram", "DLR"]],
  ];
  const WEIGHT = { Tube: 3.5, Overground: 3.5, Elizabeth: 4, Rail: 1.8, Tram: 2.5, DLR: 2.5 };
  // Journey-time bands for recolouring pins, in minutes.
  const BANDS = [30, 45, 60];
  const band = (m) => m == null ? "none" : m <= BANDS[0] ? "t1" : m <= BANDS[1] ? "t2" : m <= BANDS[2] ? "t3" : "t4";
  const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/";
  const TILES = {
    light: [ESRI + "World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", ESRI + "World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}"],
    dark: [ESRI + "World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", ESRI + "World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}"],
  };

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let uid = 0;

  function mount(container, opts) {
    if (!window.L) throw new Error("FGOHMap needs Leaflet 1.9.4 loaded first");
    opts = opts || {};
    const base = "../../data/";
    const urls = Object.assign({ listings: base + "listings.json", stations: base + "stations.json", lines: base + "lines.json", workplaces: base + "workplaces.json" }, opts.data || {});
    const isStandout = opts.isStandout || standoutRule;
    const id = "fgm" + ++uid;
    const handlers = {};
    const emit = (ev, x) => (handlers[ev] || []).forEach((f) => { try { f(x); } catch (e) { console.error(e); } });

    const S = {
      homes: Array.isArray(opts.homes) ? opts.homes : null, showGone: !!opts.showGone, theme: opts.theme || "auto",
      measure: "budget", max: null, selected: null, stations: [], stationsByName: {}, work: [], lineGroups: {}, hiddenGroups: new Set(),
    };

    // ---- DOM ----
    const root = el("div", "fgm");
    const mapEl = el("div", "fgm-map");
    mapEl.setAttribute("role", "region"); mapEl.setAttribute("aria-label", "Map of the homes");
    const tools = el("div", "fgm-tools");
    const fitBtn = el("button", "fgm-btn", "Fit to search area"); fitBtn.type = "button";
    const fitAllBtn = el("button", "fgm-btn", "Show workplaces"); fitAllBtn.type = "button";
    tools.append(fitBtn, fitAllBtn);
    const optBtn = el("button", "fgm-btn fgm-optbtn", "Map options"); optBtn.type = "button";
    optBtn.setAttribute("aria-expanded", "false"); optBtn.setAttribute("aria-controls", id + "-panel");
    const panel = el("div", "fgm-panel"); panel.id = id + "-panel"; panel.hidden = true;
    panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Map options");
    const card = el("div", "fgm-card"); card.hidden = true;
    card.setAttribute("role", "dialog"); card.setAttribute("aria-label", "Home details");
    const status = el("p", "fgm-status"); status.setAttribute("aria-live", "polite");
    root.append(mapEl, tools, optBtn, panel, card, status);
    container.append(root);

    // ---- Theme ----
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const isDark = () => S.theme === "dark" || (S.theme === "auto" && mq.matches);
    let tiles = [];

    // ---- Leaflet ----
    const map = L.map(mapEl, { zoomControl: false, zoomSnap: 0.5, minZoom: 9, maxZoom: 19, attributionControl: true });
    L.control.zoom({ position: "bottomright" }).addTo(map);
    map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
    const pane = (name, z, events) => { const p = map.createPane(name); p.style.zIndex = z; if (!events) p.style.pointerEvents = "none"; return p; };
    pane("fgm-mask", 330); pane("fgm-lines", 380, true); pane("fgm-labels", 395); pane("fgm-stations", 410, true); pane("fgm-work", 640, true);
    const lineRenderer = L.canvas({ pane: "fgm-lines", tolerance: 7 });
    const fitArea = () => map.fitBounds(L.latLngBounds(AREA), { padding: [24, 24] });
    fitArea();

    const mask = L.polygon([[[52.3, -1.8], [52.3, 1.2], [50.7, 1.2], [50.7, -1.8]], AREA], { pane: "fgm-mask", stroke: false, fillOpacity: 0.28, interactive: false, className: "fgm-maskfill" }).addTo(map);
    const edge = L.polygon(AREA, { pane: "fgm-mask", weight: 2.5, fill: false, dashArray: "9 6", interactive: false }).addTo(map);
    const stationLayer = L.layerGroup().addTo(map);
    const workLayer = L.layerGroup().addTo(map);
    const useCluster = typeof L.markerClusterGroup === "function";
    const pins = useCluster
      ? L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 50, disableClusteringAtZoom: 15, spiderfyOnMaxZoom: true, iconCreateFunction: clusterIcon })
      : L.layerGroup();
    // Standouts cluster on their own, tightly and ringed in the Standout colour, so they never hide among the rest.
    const starPins = useCluster
      ? L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 30, disableClusteringAtZoom: 14, spiderfyOnMaxZoom: true, iconCreateFunction: (c) => clusterIcon(c, true) })
      : L.layerGroup();
    map.addLayer(pins); map.addLayer(starPins);
    let walkLine = null;
    const markers = new Map();

    function cssVar(n) { return getComputedStyle(root).getPropertyValue(n).trim(); }
    function applyTheme() {
      root.classList.toggle("fgm--dark", isDark());
      tiles.forEach((t) => map.removeLayer(t));
      const [b, r] = isDark() ? TILES.dark : TILES.light;
      const o = { maxZoom: 19, maxNativeZoom: 16 };
      tiles = [
        L.tileLayer(b, { ...o, attribution: 'Tiles &copy; Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>; lines from OpenStreetMap' }).addTo(map),
        L.tileLayer(r, { ...o, pane: "fgm-labels" }).addTo(map),
      ];
      mask.setStyle({ fillColor: cssVar("--fgm-mask") });
      edge.setStyle({ color: cssVar("--fgm-edge") });
      for (const g of Object.values(S.lineGroups)) g.eachLayer((l) => l.casing && l.setStyle({ color: cssVar("--fgm-casing") }));
      stationLayer.eachLayer((l) => l.setStyle && l.setStyle({ color: cssVar("--fgm-ink"), fillColor: cssVar("--fgm-surface") }));
      if (walkLine) walkLine.setStyle({ color: cssVar("--fgm-ink") });
    }
    const onScheme = () => { if (S.theme === "auto") applyTheme(); };
    mq.addEventListener("change", onScheme);
    applyTheme();

    // ---- Journey times ----
    const timeOf = (r, m) => {
      const c = r.commute || {};
      if (m === "longest") {
        const t = S.work.map((w) => c[w.id]);
        return t.length && t.every((x) => typeof x === "number") ? Math.max(...t) : null;
      }
      return typeof c[m] === "number" ? c[m] : null;
    };
    const workName = (m) => m === "longest" ? "the longest of the four" : (S.work.find((w) => w.id === m) || {}).name || m;
    const minutes = (m) => `${m} min`;

    // ---- Which homes show ----
    function current() {
      const all = S.homes || [];
      const base = all.filter((r) => S.showGone || !CLOSED.includes(r.status));
      const placed = base.filter((r) => Array.isArray(r.loc) && r.loc.length === 2);
      let shown = placed, overMax = 0, noTime = 0;
      if (S.max != null && S.measure !== "budget") {
        shown = placed.filter((r) => { const t = timeOf(r, S.measure); if (t == null) { noTime++; return false; } if (t > S.max) { overMax++; return false; } return true; });
      }
      return { base, placed, shown, offMap: base.length - placed.length, overMax, noTime };
    }

    function pinHtml(r) {
      const cls = ["fgm-pin"];
      const t = S.measure === "budget" ? null : timeOf(r, S.measure);
      cls.push(S.measure === "budget" ? "fgm-fit-" + fit(r) : "fgm-band-" + band(t));
      if (isStandout(r)) cls.push("fgm-star");
      if (CLOSED.includes(r.status)) cls.push("fgm-gone");
      if (S.selected === r.id) cls.push("fgm-sel");
      const rent = r.rent ? gbp(r.rent / PEOPLE) : "?";
      const extra = S.measure === "budget" ? "" : `<small>${t == null ? "no time" : esc(minutes(t))}</small>`;
      return `<span class="${cls.join(" ")}">${isStandout(r) ? '<i aria-hidden="true">★</i>' : ""}${rent}${extra}</span>`;
    }
    const icon = (r) => L.divIcon({ className: "fgm-iconwrap", html: pinHtml(r), iconSize: [0, 0], iconAnchor: [0, 0] });
    function label(r) {
      const t = S.measure === "budget" ? null : timeOf(r, S.measure);
      return `${r.title}, ${r.rent ? gbp(r.rent / PEOPLE) + " each" : "price unknown"}${t != null ? `, ${t} minutes to ${workName(S.measure)}` : ""}${isStandout(r) ? ", Standout" : ""}`;
    }
    function clusterIcon(c, star) {
      const homes = c.getAllChildMarkers().map((m) => m.fgmHome);
      let cls, sub;
      if (S.measure === "budget") {
        const pp = homes.filter((h) => h.rent).map((h) => h.rent / PEOPLE), low = pp.length ? Math.min(...pp) : null;
        cls = "fgm-fit-" + (low == null ? "none" : low <= TARGET_PP ? "good" : low <= MAX_PP ? "warn" : "bad");
        sub = low ? `from ${gbp(low)}` : "";
      } else {
        const ts = homes.map((h) => timeOf(h, S.measure)).filter((x) => x != null), best = ts.length ? Math.min(...ts) : null;
        cls = "fgm-band-" + band(best); sub = best != null ? `from ${best} min` : "no times";
      }
      return L.divIcon({ className: "fgm-iconwrap", html: `<span class="fgm-clu ${cls}${star ? " fgm-clu-star" : ""}"><b>${star ? "★ " : ""}${homes.length}</b><span>${sub}</span></span>`, iconSize: [0, 0] });
    }

    function draw() {
      const c = current();
      pins.clearLayers(); starPins.clearLayers();
      const plain = [], stars = [];
      for (const r of c.shown) {
        let m = markers.get(r.id);
        if (!m) {
          m = L.marker(r.loc, { icon: icon(r), keyboard: true, title: label(r), alt: label(r) });
          m.fgmHome = r;
          m.on("click", () => select(r.id, true));
          markers.set(r.id, m);
        } else { m.fgmHome = r; m.setLatLng(r.loc); m.setIcon(icon(r)); }
        if (m._icon) m._icon.setAttribute("aria-label", label(r));
        m.options.title = label(r);
        m.setZIndexOffset(isStandout(r) ? 1000 : CLOSED.includes(r.status) ? -500 : 0);
        (isStandout(r) ? stars : plain).push(m);
      }
      if (useCluster) { pins.addLayers(plain); starPins.addLayers(stars); }
      else { plain.forEach((m) => pins.addLayer(m)); stars.forEach((m) => starPins.addLayer(m)); }
      let msg = `${c.shown.length} ${c.shown.length === 1 ? "home" : "homes"} on the map.`;
      if (c.offMap) msg += ` ${c.offMap} not on the map (no location yet).`;
      if (c.overMax) msg += ` ${c.overMax} over ${S.max} min.`;
      if (c.noTime) msg += ` ${c.noTime} with no journey time yet.`;
      status.textContent = msg;
      renderPanel();
      if (S.selected && !c.shown.some((r) => r.id === S.selected)) select(null);
    }

    // ---- Selected home card ----
    function select(hid, fromMap) {
      const prev = S.selected;
      S.selected = hid || null;
      for (const x of [prev, S.selected]) { const m = x && markers.get(x); if (m && m.fgmHome) m.setIcon(icon(m.fgmHome)); }
      if (walkLine) { map.removeLayer(walkLine); walkLine = null; }
      const r = S.selected && (S.homes || []).find((h) => h.id === S.selected);
      if (!r) { card.hidden = true; card.textContent = ""; if (prev) emit("select", null); return; }
      renderCard(r);
      const st = r.station && S.stationsByName[r.station.name];
      if (st && r.loc) walkLine = L.polyline([r.loc, [st.lat, st.lon]], { color: cssVar("--fgm-ink"), weight: 2.5, dashArray: "2 6", lineCap: "round", interactive: false }).addTo(map);
      const m = markers.get(r.id);
      // In a narrow container the card covers the bottom, so keep the pin in the strip above it.
      const reveal = () => {
        if (!narrow()) return map.panTo(r.loc);
        const p = map.latLngToContainerPoint(r.loc), y = Math.max(60, (root.clientHeight - card.offsetHeight) / 2 + 20);
        map.panBy([p.x - root.clientWidth / 2, p.y - y]);
      };
      if (r.loc) {
        if (fromMap) { if (narrow()) reveal(); }
        else if (m && useCluster && (pins.hasLayer(m) || starPins.hasLayer(m))) (pins.hasLayer(m) ? pins : starPins).zoomToShowLayer(m, reveal);
        else { map.setView(r.loc, Math.max(map.getZoom(), 14), { animate: false }); reveal(); }
      }
      emit("select", r);
    }
    function renderCard(r) {
      card.textContent = "";
      const close = el("button", "fgm-close", "Close"); close.type = "button"; close.setAttribute("aria-label", "Close home details");
      close.onclick = () => { const m = markers.get(S.selected); select(null); if (m && m._icon) m._icon.focus(); };
      const pic = safe(r.photo);
      const ph = el("div", "fgm-photo" + (pic ? "" : " fgm-nophoto"));
      if (pic) {
        const img = el("img"); img.src = pic; img.alt = `Photo of ${r.title}`; img.loading = "lazy"; img.referrerPolicy = "no-referrer";
        img.onerror = () => { img.remove(); ph.classList.add("fgm-nophoto"); ph.textContent = "No photo"; };
        ph.append(img);
      } else ph.textContent = "No photo";
      const body = el("div", "fgm-cardbody");
      const h = el("h3", "fgm-addr", r.title); h.tabIndex = -1;
      body.append(h);
      const tags = el("p", "fgm-tags");
      if (isStandout(r)) tags.append(el("span", "fgm-tag fgm-tag-star", "Standout"));
      if (CLOSED.includes(r.status)) tags.append(el("span", "fgm-tag", r.status === "gone" ? "Gone / let" : "Ruled out"));
      if (r.off_market) tags.append(el("span", "fgm-tag fgm-tag-warn", r.off_market.why));
      if (r.sharers === "no") tags.append(el("span", "fgm-tag fgm-tag-warn", "No sharers"));
      if (tags.childNodes.length) body.append(tags);
      const price = el("p", "fgm-price fgm-fit-" + fit(r));
      if (r.rent) {
        price.append(el("b", null, `${gbp(r.rent / PEOPLE)} each`), ` ${gbp(r.rent)} a month`);
        const was = previous(r); if (was && was > r.rent) price.append(" ", el("s", null, `was ${gbp(was)}`));
      } else price.textContent = "Price unknown";
      body.append(price);
      const facts = [r.area, r.beds && `${r.beds} bed`, r.baths && `${r.baths} bath`].filter(Boolean).join(", ");
      if (facts) body.append(el("p", "fgm-facts", facts));
      if (r.station) body.append(el("p", "fgm-stn" + (r.station.walk <= STANDOUT.walk ? " fgm-near" : ""), `${r.station.walk} min walk to ${r.station.name} (${r.station.kind})`));
      const ul = el("ul", "fgm-times");
      const longest = timeOf(r, "longest");
      for (const w of S.work) {
        const t = timeOf(r, w.id), li = el("li", "fgm-band-" + band(t));
        li.append(el("span", "fgm-wname", w.name), el("span", "fgm-wt", t == null ? "not worked out yet" : minutes(t) + (w.mode === "drive" ? " drive, no traffic" : "")));
        if (t != null && t === longest) li.classList.add("fgm-longest");
        ul.append(li);
      }
      if (S.work.length) {
        body.append(ul);
        body.append(el("p", "fgm-note", "Public transport arriving 09:00 on a Wednesday (TfL), except where it says drive."));
      }
      const { main, others, named } = adverts(r);
      const acts = el("p", "fgm-acts");
      if (main) { const a = el("a", "fgm-open", `Open on ${named(main)}`); a.href = main; a.target = "_blank"; a.rel = "noopener"; acts.append(a); }
      if (others.length) {
        const alt = el("span", "fgm-alt", "Also on ");
        others.forEach((u, i) => { const a = el("a", null, named(u)); a.href = u; a.target = "_blank"; a.rel = "noopener"; alt.append(i ? ", " : "", a); });
        acts.append(alt);
      }
      body.append(acts);
      card.append(close, ph, body);
      card.hidden = false;
      h.focus({ preventScroll: true });
    }

    // ---- Options panel ----
    function renderPanel() {
      panel.textContent = "";
      const head = el("div", "fgm-panelhead");
      head.append(el("h3", null, "Map options"));
      const x = el("button", "fgm-close", "Close"); x.type = "button"; x.onclick = () => togglePanel(false);
      head.append(x); panel.append(head);

      // Colour pins by
      const f1 = el("fieldset", "fgm-set");
      f1.append(el("legend", null, "Colour pins by"));
      const sel = el("select", "fgm-select"); sel.setAttribute("aria-label", "Colour pins by");
      const opts = [["budget", "Rent each (budget)"], ...S.work.map((w) => [w.id, `Time to ${w.name}${w.mode === "drive" ? " (drive)" : ""}`]), ["longest", "Longest of the four"]];
      for (const [v, t] of opts) { const o = el("option", null, t); o.value = v; o.selected = S.measure === v; sel.append(o); }
      sel.onchange = () => { S.measure = sel.value; if (S.measure === "budget") S.max = null; draw(); focusIn(".fgm-select"); };
      f1.append(sel);
      const key = el("div", "fgm-key");
      const sw = (cls, t) => { const s = el("span"); s.append(el("i", "fgm-sw " + cls), t); key.append(s); };
      if (S.measure === "budget") { sw("fgm-fit-good", "£1,000 each or less"); sw("fgm-fit-warn", "up to £1,200"); sw("fgm-fit-bad", "over £1,200"); }
      else { sw("fgm-band-t1", `${BANDS[0]} min or less`); sw("fgm-band-t2", `up to ${BANDS[1]}`); sw("fgm-band-t3", `up to ${BANDS[2]}`); sw("fgm-band-t4", `over ${BANDS[2]}`); sw("fgm-band-none", "no time yet"); }
      sw("fgm-sw-star", "Standout");
      f1.append(key);
      if (S.measure !== "budget") {
        const lab = el("label", "fgm-range");
        const val = el("output", null, S.max == null ? "Any time" : `${S.max} min or less`);
        const rng = el("input"); rng.type = "range"; rng.min = 15; rng.max = 95; rng.step = 5; rng.value = S.max == null ? 95 : S.max;
        rng.setAttribute("aria-label", `Maximum time to ${workName(S.measure)}`);
        rng.oninput = () => { val.textContent = +rng.value >= 95 ? "Any time" : `${rng.value} min or less`; };
        rng.onchange = () => { S.max = +rng.value >= 95 ? null : +rng.value; draw(); focusIn(".fgm-range input"); };
        lab.append(el("span", null, `Only homes within`), val, rng);
        f1.append(lab);
        if (S.measure === "wentworth") f1.append(el("p", "fgm-note", "Wentworth is a drive time with no traffic."));
        else if (S.measure === "longest") f1.append(el("p", "fgm-note", "For each home, the slowest of the four journeys, Wentworth's drive included."));
      }
      panel.append(f1);

      // Fairest for all four
      const f3 = el("fieldset", "fgm-set");
      f3.append(el("legend", null, "Fairest for all four"));
      const c = current();
      const ranked = c.placed.filter((r) => !CLOSED.includes(r.status)).map((r) => [r, timeOf(r, "longest")]).filter(([, t]) => t != null).sort((a, b) => a[1] - b[1]);
      if (!ranked.length) f3.append(el("p", "fgm-note", "Journey times are still being worked out. Check back later."));
      else {
        f3.append(el("p", "fgm-note", "Homes whose slowest commute is shortest, so nobody gets a bad deal."));
        const ol = el("ol", "fgm-fair");
        for (const [r, t] of ranked.slice(0, 8)) {
          const who = S.work.filter((w) => timeOf(r, w.id) === t).map((w) => w.name).join(" and ");
          const b = el("button", "fgm-fairbtn"); b.type = "button";
          b.append(el("span", "fgm-fairname", r.title), el("span", "fgm-fairmeta", `${r.rent ? gbp(r.rent / PEOPLE) + " each, " : ""}longest ${t} min (${who})`));
          b.onclick = () => { if (narrow()) togglePanel(false); select(r.id); };
          const li = el("li"); li.append(b); ol.append(li);
        }
        f3.append(ol);
        const missing = c.placed.filter((r) => !CLOSED.includes(r.status)).length - ranked.length;
        if (missing) f3.append(el("p", "fgm-note", `${missing} more without all four times yet.`));
      }
      panel.append(f3);

      // Lines
      const f2 = el("fieldset", "fgm-set");
      f2.append(el("legend", null, "Lines (tap a line for its name)"));
      for (const [gid, name] of GROUPS) {
        if (!S.lineGroups[gid]) continue;
        const lab = el("label", "fgm-check");
        const cb = el("input"); cb.type = "checkbox"; cb.checked = !S.hiddenGroups.has(gid);
        cb.onchange = () => { cb.checked ? (S.hiddenGroups.delete(gid), map.addLayer(S.lineGroups[gid])) : (S.hiddenGroups.add(gid), map.removeLayer(S.lineGroups[gid])); };
        const swatch = el("span", "fgm-lsw");
        swatch.style.background = S.lineGroups[gid].fgmSwatch;
        lab.append(cb, swatch, name);
        f2.append(lab);
      }
      const lab = el("label", "fgm-check");
      const cb = el("input"); cb.type = "checkbox"; cb.checked = map.hasLayer(stationLayer);
      cb.onchange = () => (cb.checked ? map.addLayer(stationLayer) : map.removeLayer(stationLayer));
      lab.append(cb, el("span", "fgm-lsw fgm-lsw-stn"), "Stations");
      f2.append(lab);
      panel.append(f2);

      // Homes
      const f4 = el("fieldset", "fgm-set");
      f4.append(el("legend", null, "Homes"));
      const g = el("label", "fgm-check");
      const gcb = el("input"); gcb.type = "checkbox"; gcb.checked = S.showGone;
      gcb.onchange = () => { S.showGone = gcb.checked; draw(); focusIn(".fgm-gonebox"); };
      gcb.className = "fgm-gonebox";
      g.append(gcb, "Show let and gone homes");
      f4.append(g);
      panel.append(f4);
    }
    const focusIn = (sel) => { const e = panel.querySelector(sel); if (e) e.focus(); };
    const narrow = () => root.clientWidth < 560;
    function togglePanel(open) {
      panel.hidden = !open; optBtn.setAttribute("aria-expanded", String(open));
      if (open) { const f = panel.querySelector("select, input, button.fgm-fairbtn"); if (f) f.focus(); } else optBtn.focus();
    }
    optBtn.onclick = () => togglePanel(panel.hidden);
    fitBtn.onclick = () => fitArea();
    fitAllBtn.onclick = () => {
      const pts = AREA.concat(S.work.map((w) => [w.lat, w.lon]));
      map.fitBounds(L.latLngBounds(pts), { padding: [30, 30] });
    };
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      if (!panel.hidden) togglePanel(false); else if (!card.hidden) { const m = markers.get(S.selected); select(null); if (m && m._icon) m._icon.focus(); }
    };
    root.addEventListener("keydown", onKey);

    const zoomCls = () => { const z = map.getZoom(); root.classList.toggle("fgm-z13", z >= 13); root.classList.toggle("fgm-z14", z >= 14); };
    map.on("zoomend", zoomCls); zoomCls();

    // ---- Data ----
    const load = (u) => fetch(u, { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.json(); });
    const ready = Promise.all([
      S.homes ? Promise.resolve(null) : load(urls.listings),
      load(urls.stations).catch(() => []), load(urls.lines).catch(() => ({ lines: [] })), load(urls.workplaces).catch(() => []),
    ]).then(([listings, stations, lines, work]) => {
      if (destroyed) return;
      if (!S.homes) S.homes = listings || [];
      S.stations = stations; S.stationsByName = Object.fromEntries(stations.map((s) => [s.name, s]));
      S.work = work;
      drawLines(lines.lines || []);
      for (const s of stations) {
        L.circleMarker([s.lat, s.lon], { pane: "fgm-stations", radius: 4, weight: 2, color: cssVar("--fgm-ink"), fillColor: cssVar("--fgm-surface"), fillOpacity: 1 })
          .bindTooltip(`${esc(s.name)}`, { permanent: true, direction: "right", offset: [5, 0], className: "fgm-stnlbl" })
          .addTo(stationLayer);
      }
      for (const w of work) {
        const ic = L.divIcon({ className: "fgm-iconwrap", html: `<span class="fgm-work fgm-work-${esc(w.mode)}"><b>${esc(w.name)}</b></span>`, iconSize: [0, 0] });
        L.marker([w.lat, w.lon], { icon: ic, pane: "fgm-work", keyboard: false, title: w.full })
          .bindTooltip(`${esc(w.full)}${w.mode === "drive" ? "<br>Times are drive times, no traffic" : ""}`, { direction: "top", offset: [0, -14], className: "fgm-tip" })
          .addTo(workLayer);
      }
      draw();
      emit("ready", api);
      return api;
    }).catch((e) => { status.textContent = "Couldn't load the map data. Reload the page to try again."; console.error(e); throw e; });

    function drawLines(lines) {
      const casing = cssVar("--fgm-casing");
      // National Rail first so coloured lines sit on top.
      const order = [...lines].sort((a, b) => (b.kind === "Rail") - (a.kind === "Rail"));
      for (const [gid, , kinds] of GROUPS) {
        const ls = order.filter((l) => kinds.includes(l.kind));
        if (!ls.length) continue;
        const g = L.layerGroup();
        g.fgmSwatch = ls.length === 1 || gid === "rail" ? ls[0].colour : `linear-gradient(90deg, ${ls.map((l) => l.colour).join(", ")})`;
        for (const l of ls) {
          const w = WEIGHT[l.kind] || 3;
          const cas = L.polyline(l.paths, { renderer: lineRenderer, color: casing, weight: w + (l.kind === "Rail" ? 1.2 : 2.5), opacity: l.kind === "Rail" ? 0.5 : 0.9, interactive: false });
          cas.casing = true;
          const line = L.polyline(l.paths, { renderer: lineRenderer, color: l.colour, weight: w, opacity: l.kind === "Rail" ? 0.85 : 1 });
          const ops = l.operators && l.operators.filter((o) => o !== "National Rail");
          line.bindPopup(`<b>${esc(l.name)}</b>${ops && ops.length ? `<br><small>${esc(ops.join(", "))}</small>` : ""}`, { className: "fgm-linepop", maxWidth: 240, autoPan: false });
          g.addLayer(cas); g.addLayer(line);
        }
        S.lineGroups[gid] = g;
        g.addTo(map);
      }
    }

    let destroyed = false;
    const api = {
      map, ready,
      setHomes(list) { S.homes = Array.isArray(list) ? list : []; if (S.work) draw(); return api; },
      select(hid) { select(hid, false); return api; },
      on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); return api; },
      off(ev, fn) { handlers[ev] = (handlers[ev] || []).filter((f) => f !== fn); return api; },
      fitArea() { fitArea(); return api; },
      setTheme(t) { S.theme = t || "auto"; applyTheme(); return api; },
      setMeasure(m, max) { S.measure = m || "budget"; S.max = m && m !== "budget" && max != null ? max : null; draw(); return api; },
      showGone(on) { S.showGone = !!on; draw(); return api; },
      invalidateSize() { map.invalidateSize(); return api; },
      destroy() { destroyed = true; mq.removeEventListener("change", onScheme); map.remove(); root.remove(); },
    };
    return api;
  }

  window.FGOHMap = { mount, version: "1.0.0" };
})();

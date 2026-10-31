// Where each home sits on the map, worked out the same way the scripts do.
// street() is a port of street() in scripts/ingest_alerts.py and locate() of locate() in scripts/stations.py,
// but read-only: it only looks the street up in data/geo.json, never asks OpenStreetMap.
(function (root) {
  const STREET = /(?<=\w )(st)\b|\b(rd|road|street|avenue|lane|gardens|close|way|grove|place|mews|row|crescent|hill|drive|terrace|square|walk|court|park|rise|vale|green|parade|yard|wharf|house|common|villas|path|mansions)\b/gi;

  // "Mascotte Road, London, SW15" -> "mascotte road"; "5 Bed Terraced House, Claybrook Road, W6" -> "claybrook road".
  function street(title) {
    let t = (title || "").replace(/^\s*\d+\s+bed(room)?s?\b.*?\bto (rent|let)\s*[-–—]\s*/i, "");
    t = t.replace(/^.*\bsq\.? ?ft\s+/i, "");
    const parts = t.split(/,|\.\s+(?=[A-Z]{1,2}\d)|\s+[-–—�]\s+/).map((p) => p.replace(/\s+/g, " ").trim());
    const first = parts.find((p) => !/\bbed(room)?s?\b|^[a-z]{2,6}\d{5,}$/i.test(p)) || "";
    const all = [...first.matchAll(STREET)];
    const m = all[all.length - 1];
    if (m) {
      const upto = first.slice(0, m.index + m[0].length);
      if (!/^(raynes|colliers|putney|wimbledon|clapham)\s+\w+$/i.test(upto)) {
        const s = upto.replace(/^\d+\s+/, "").toLowerCase();
        return s.replace(/ st$/, " street").replace(/ rd$/, " road");
      }
    }
    if (/\w(way|heath|view|side)$/i.test(first)) return first.toLowerCase();
    const w = /\b(\w+(?:way|heath|view|side))\b/i.exec(first);
    return w ? w[1].toLowerCase() : "";
  }

  // The geo.json key for a home: "street|postcode district" or "street|area".
  function geoKey(home) {
    const s = street(home.title);
    if (!s) return null;
    const area = (home.area || "").split("/")[0].trim();
    let pc = /\b(SW|SE|NW|KT|SM|CR|W)\d{1,2}\b/.exec(home.title || "");
    if (!pc) for (const u of home.links || []) { pc = /(?<=[/-])(sw|se|nw|kt|sm|cr|w)\d{1,2}(?=[/-])/.exec(u); if (pc) break; }
    return `${s}|${pc ? pc[0] : area}`.toLowerCase();
  }

  // Small fixed offset from the id, so approximate homes round one station don't stack exactly.
  function jitter(id) {
    let h = 2166136261;
    for (const c of String(id)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
    const a = ((h >>> 0) % 3600) / 3600 * 2 * Math.PI, r = 0.0012 + ((h >>> 12) % 1000) / 1000 * 0.0016;
    return [Math.sin(a) * r, Math.cos(a) * r * 1.6];
  }

  const metres = (a, b) => {
    const k = Math.PI / 180, x = (b[1] - a[1]) * k * Math.cos((a[0] + b[0]) / 2 * k), y = (b[0] - a[0]) * k;
    return Math.hypot(x, y) * 6371000;
  };
  // Street name -> every [lat, lon] geo.json has for it under any district or area.
  const byName = new WeakMap();
  function names(geo) {
    if (!byName.has(geo)) {
      const m = new Map();
      for (const [k, v] of Object.entries(geo)) {
        if (!Array.isArray(v)) continue;
        const n = k.split("|")[0];
        if (n) { if (!m.has(n)) m.set(n, []); m.get(n).push(v); }
      }
      byName.set(geo, m);
    }
    return byName.get(geo);
  }

  // {lat, lon, how}: how is "street" (its exact geo.json key), "name" (same street name filed under another
  // district, nearest the home's station), "station" or "area" (both approximate), or null.
  function place(home, geo, stationsByName) {
    const key = geoKey(home), hit = key && geo[key];
    if (Array.isArray(hit)) return { lat: hit[0], lon: hit[1], how: "street" };
    const st = home.station && stationsByName[home.station.name];
    const s = key && key.split("|")[0], same = s ? names(geo).get(s) || [] : [];
    if (same.length) {
      const best = st ? same.reduce((a, b) => (metres(a, [st.lat, st.lon]) <= metres(b, [st.lat, st.lon]) ? a : b)) : same.length === 1 ? same[0] : null;
      // A same-named street far from the home's station is another street (as in locate()).
      if (best && (!st || metres(best, [st.lat, st.lon]) < 2500)) return { lat: best[0], lon: best[1], how: "name" };
    }
    const j = jitter(home.id);
    if (st) {
      // The walk time says how far from the station the home is (stations.py: metres * 1.3 / 80), not which way.
      const d = Math.min(Math.max(((home.station.walk || 5) * 80) / 1.3, 120), 1500) / 111320;
      const n = Math.hypot(j[0], j[1] / 1.6) || 1;
      return { lat: st.lat + (j[0] / n) * d, lon: st.lon + (j[1] / n) * d, how: "station" };
    }
    const area = (home.area || "").split("/")[0].trim().toLowerCase();
    const c = area && geo["|" + area];
    if (Array.isArray(c)) return { lat: c[0] + j[0], lon: c[1] + j[1], how: "area" };
    return null;
  }

  const api = { street, geoKey, place, jitter };
  if (typeof module !== "undefined") module.exports = api; else root.FGOHGeo = api;
})(this);

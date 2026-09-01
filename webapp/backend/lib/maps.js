// Google Places helpers — live shop data (real ratings, real opening hours).
// Requires GOOGLE_MAPS_API_KEY (Places API enabled) in the environment.

const MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY || "";

function fetchJson(url, ms = 5000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal })
    .then((r) => r.json())
    .finally(() => clearTimeout(t));
}

function districtOf(addr = "") {
  const zh = addr.match(/([一-鿿]{1,2}區)/);
  if (zh) return zh[1];
  const en = addr.match(/([A-Za-z][A-Za-z' ]*?District)/);
  return en ? en[1] : "台南";
}

function todayInTaipei() {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    weekday: "long",
  }).format(new Date());
}

// Text search scoped to Tainan. Returns a compact candidate pool (quality
// pre-filtered) — small enough to hand to the model without blowing tokens.
async function searchPlaces(query, { limit = 8 } = {}) {
  if (!MAPS_KEY) throw new Error("GOOGLE_MAPS_API_KEY is not set");
  const s = await fetchJson(
    `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(
      query + " 台南"
    )}&language=en&key=${MAPS_KEY}`
  );
  return (s.results || [])
    .filter((r) => (r.rating || 0) >= 4.0 && (r.user_ratings_total || 0) >= 50)
    .filter((r) => r.business_status !== "CLOSED_PERMANENTLY")
    .slice(0, limit)
    .map((r) => ({
      name: r.name,
      place_id: r.place_id,
      rating: r.rating || null,
      reviews: r.user_ratings_total || 0,
      district: districtOf(r.formatted_address),
      address: r.formatted_address || "",
      open_now:
        r.opening_hours && typeof r.opening_hours.open_now === "boolean"
          ? r.opening_hours.open_now
          : null,
    }));
}

// Verified per-shop data: rating, open-now status, today's hours, maps URL.
async function placeDetails(placeId) {
  if (!MAPS_KEY) throw new Error("GOOGLE_MAPS_API_KEY is not set");
  const d = await fetchJson(
    `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,rating,opening_hours,url,formatted_address&language=en&key=${MAPS_KEY}`
  );
  const res = d.result || {};
  const oh = res.opening_hours || {};
  const weekday = todayInTaipei();
  const todayLine = (oh.weekday_text || []).find((l) => l.startsWith(weekday)) || "";
  return {
    name: res.name || "",
    rating: res.rating || null,
    district: districtOf(res.formatted_address),
    open_now:
      typeof oh.open_now === "boolean" ? oh.open_now : null,
    today_hours: todayLine.replace(`${weekday}: `, "") || null,
    url: res.url || "",
  };
}

// Verify one curated-CSV shop against Google Places (used by the campaign
// fast path, where the backend — not the model — picks and checks shops).
async function verifyShop(row) {
  const base = {
    name: row["餐廳名稱"],
    district: row["行政區"],
    address: row["地址"] || "",
  };
  if (!MAPS_KEY) return { ...base, verified: false };
  try {
    const s = await fetchJson(
      `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(
        `${base.name} 台南`
      )}&language=en&key=${MAPS_KEY}`
    );
    const first = s.results && s.results[0];
    if (!first) return { ...base, verified: false };
    const d = await placeDetails(first.place_id);
    return {
      ...base,
      verified: true,
      rating: d.rating || first.rating || "",
      openNow:
        d.open_now === true ? "OPEN NOW" : d.open_now === false ? "CLOSED NOW" : "UNKNOWN",
      todayHours: d.today_hours || "",
      url: d.url,
    };
  } catch {
    return { ...base, verified: false };
  }
}

module.exports = {
  MAPS_KEY,
  fetchJson,
  districtOf,
  todayInTaipei,
  searchPlaces,
  placeDetails,
  verifyShop,
};

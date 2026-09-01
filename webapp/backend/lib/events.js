// City / merchant event layer — a plain CSV stands in for the city-maintained
// CMS (a Google Sheet in production). Whatever is active THIS month is
// surfaced proactively (UI banner) and boosted in recommendations.

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const EVENTS_CSV =
  process.env.EVENTS_CSV_PATH ||
  path.join(REPO_ROOT, "data", "mango_ice_list.csv");

const EVENT_META = {
  芒果季: {
    label: "Mango Season",
    emoji: "🥭",
    blurb:
      "It's peak mango shaved-ice season in Tainan — top spots below (plus quieter picks to skip the queues).",
    query:
      "Show me a few of the best mango shaved ice (芒果冰) spots open right now across Tainan — pick different districts so I have options.",
  },
  七股海鮮節: {
    label: "Qigu Seafood Festival",
    emoji: "🦪",
    blurb:
      "Qigu Seafood Festival is on — the freshest seafood and Michelin Bib Gourmand favorites.",
    query:
      "Show me a few great seafood spots open right now around Tainan's coast (安平 / 七股 / 北門) — different areas so I have options.",
  },
};

function taipeiMonth() {
  const s = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    month: "numeric",
  }).format(new Date());
  return parseInt(s, 10);
}

function parseCsv(text) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const header = lines.shift().split(",");
  return lines.map((line) => {
    const cells = line.split(",");
    const row = {};
    header.forEach((h, i) => (row[h.trim()] = (cells[i] || "").trim()));
    return row;
  });
}

function readRows() {
  try {
    return parseCsv(fs.readFileSync(EVENTS_CSV, "utf8"));
  } catch (e) {
    console.error("events read failed:", e.message);
    return [];
  }
}

// All CSV rows belonging to one event (e.g. 芒果季) — the official partner list.
function rowsForEvent(event) {
  return readRows().filter((r) => (r["推薦季度"] || "").includes(event));
}

// Deterministic rotation: the n least-recommended partner shops of an event
// (distribution-log counts ascending, CSV order as tiebreak). Each serving
// records its picks, so the next request naturally rotates to other shops.
function pickPromoShops(event, counts, n = 3) {
  return rowsForEvent(event)
    .map((r, i) => ({ r, i, c: counts[r["餐廳名稱"]] || 0 }))
    .sort((a, b) => a.c - b.c || a.i - b.i)
    .slice(0, n)
    .map((x) => x.r);
}

// Events active this month, grouped, with banner metadata for the UI.
function getPromotions() {
  const month = taipeiMonth();
  const byEvent = new Map();
  for (const r of readRows()) {
    const season = r["推薦季度"] || "";
    const mm = season.match(/(\d+)月/);
    if (!mm || parseInt(mm[1], 10) !== month) continue; // not active this month
    const em = season.match(/[（(](.+?)[)）]/);
    const event = em ? em[1] : season;
    if (!byEvent.has(event)) byEvent.set(event, []);
    byEvent.get(event).push({
      name: r["餐廳名稱"],
      area: r["行政區"],
      feature: r["招牌特色"],
      note: r["備註/適合情境"] || "",
    });
  }

  const promos = [];
  for (const [event, shops] of byEvent) {
    const meta = EVENT_META[event] || {
      label: event,
      emoji: "🎉",
      blurb: `${event} is happening in Tainan right now.`,
      query: `What's good for ${event} near me right now?`,
    };
    // Stable banner: always the first 4 shops in CSV order — the city
    // controls the lineup simply by ordering the CSV.
    promos.push({ event, month, ...meta, shops: shops.slice(0, 4) });
  }
  return promos;
}

module.exports = { EVENT_META, getPromotions, pickPromoShops, taipeiMonth };

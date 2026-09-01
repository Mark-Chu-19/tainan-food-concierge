// Tainan Food Concierge — backend bridge
// Exposes POST /chat that talks to the existing Hermes food agent via the CLI.
//   Request:  { sessionId: "<browser session>", message: "<user text>" }
//   Response: { reply: "<agent text>", sessionId: "<same browser session>" }
//
// Under the hood it runs:  hermes chat -q "<message>" -Q [--resume <hermesSessionId>]
//   stdout = clean final reply, stderr carries "session_id: <id>".
// The first message of a browser session creates a fresh Hermes session; we
// capture its id from stderr and --resume it on every later message so the
// conversation keeps context.
//
// CROSS-USER FAIR DISTRIBUTION (backend-managed, so it's reliable — we don't
// depend on the model remembering to call a tool):
//   • Before each turn we read a shared log of shops already recommended to
//     OTHER users, and inject an "avoid these" note into the message so two
//     users asking for the same dish get routed to different shops.
//   • After each reply we parse the shop names out of it and record them.
//   The log holds only shop names + counts (not personal data), so sharing it
//   across sessions is intentional — unlike the per-chat dietary profile.

const express = require("express");
const cors = require("cors");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

// ── Config ────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8787;
const HERMES_BIN = process.env.HERMES_BIN || "/Users/markchu/.local/bin/hermes";
const WORKDIR =
  process.env.HERMES_WORKDIR ||
  "/Users/markchu/Desktop/桌面 - Mark Chu的 MacBook Pro/CMU求職/Foxconn/AI Agent";
const CHILD_PATH = `/opt/homebrew/bin:${process.env.HOME}/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin${
  process.env.PATH ? ":" + process.env.PATH : ""
}`;
const REQUEST_TIMEOUT_MS = Number(process.env.CHAT_TIMEOUT_MS || 120000);
// Demo mode: the LLM brain is replaced by a scripted responder, but shop data
// still comes LIVE from Google Places (ratings + opening hours), and the
// fair-distribution rotation runs for real. Set MOCK_MODE=0 to use Hermes.
const MOCK_MODE = process.env.MOCK_MODE !== "0";

// Shared distribution log (same file distlog.mjs uses).
const DIST_DIR = path.join(os.homedir(), ".hermes", "tainan-distlog");
const DIST_LOG = path.join(DIST_DIR, "log.json");
const MAX_AVOID = 8; // cap how many shops we ask the agent to avoid

// browserSessionId -> { hermesSessionId, turns }
// Conversations must not grow unbounded: every turn re-sends the whole history
// (fat Maps tool results included) to Gemini, so a long-lived session slows
// down each turn until it exceeds the timeout. Two guards:
//   • TURN_LIMIT: rotate to a fresh hermes session after N turns
//   • on timeout: drop the mapping so the retry starts fresh (self-healing)
const sessions = new Map();
const TURN_LIMIT = 10;

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ── Distribution log helpers (rolling time window) ───────────────────
// File format: { "<shop>": [epochMs, ...] } — one timestamp per recommendation.
// Only recommendations inside DIST_WINDOW_MS (default 2h) count; older entries
// expire automatically, so "recently recommended" stays true to its name and
// the log never grows unbounded. readLog() still returns { shop: count } so
// every consumer (avoidList, pickPromoShops, City View) works unchanged.
const DIST_WINDOW_MS = Number(process.env.DIST_WINDOW_MS || 2 * 60 * 60 * 1000);

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(DIST_LOG, "utf8"));
  } catch {
    return {};
  }
}
function pruneStore(store) {
  const now = Date.now();
  const out = {};
  for (const [name, v] of Object.entries(store)) {
    // Legacy plain-number entries carry no timestamps → treat as expired.
    const arr = Array.isArray(v) ? v.filter((t) => now - t < DIST_WINDOW_MS) : [];
    if (arr.length) out[name] = arr;
  }
  return out;
}
function writeLog(store) {
  try {
    fs.mkdirSync(DIST_DIR, { recursive: true });
    fs.writeFileSync(DIST_LOG, JSON.stringify(store, null, 2));
  } catch (e) {
    console.error("distlog write failed:", e.message);
  }
}
// Windowed counts: { shop: recommendations within the window }
function readLog() {
  const store = pruneStore(readStore());
  const counts = {};
  for (const [name, arr] of Object.entries(store)) counts[name] = arr.length;
  return counts;
}
function bumpShops(names) {
  if (!names.length) return;
  const store = pruneStore(readStore());
  const now = Date.now();
  for (const n of names) (store[n] = store[n] || []).push(now);
  writeLog(store);
}
// Most-recommended shops first, capped — the ones worth steering away from.
function avoidList() {
  const log = readLog();
  return Object.entries(log)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_AVOID)
    .map(([name]) => name);
}

// Pull shop names out of a reply. Recommendation lines look like:
//   "1. 豪牛牛肉湯 (Hao Niu Beef Soup) — 中西區 · ⭐4.9 ..."
//   "郡西溫體牛肉湯 (Junxi Fresh Beef Soup) · 5.0 stars ..."
// The name is the text before the first " (", " —", " ·", or " -".
function extractShops(reply) {
  const names = [];
  for (const raw of reply.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/^next[?:]/i.test(line)) continue; // skip the "Next?" suggestion line
    // a shop headline carries the star rating (new clean format) or a maps link (fallback)
    if (!/⭐|stars|maps\.google|maps\/place|google\.com\/maps/i.test(line)) continue;
    let name = line.replace(/^\s*\d+[.)]\s*/, "").replace(/\*\*/g, "");
    name = name.split(/\s*[（(]|\s*⭐| — | – | · /)[0].trim();
    if (name.length >= 2 && name.length <= 40 && !/^https?:/i.test(name)) {
      names.push(name);
    }
  }
  return [...new Set(names)];
}

// ── Proactive promotions (seasonal event banner) ──────────────────────
// Reads data/mango_ice_list.csv (city/merchant-maintained seasonal events) and
// surfaces whatever is active THIS month, so the UI can advertise it before the
// user even asks. Backend-driven = reliable (no dependency on the model).
const MANGO_CSV = path.join(WORKDIR, "data", "mango_ice_list.csv");
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

// All CSV rows belonging to one event (e.g. 芒果季) — the official partner list.
function rowsForEvent(event) {
  let rows;
  try {
    rows = parseCsv(fs.readFileSync(MANGO_CSV, "utf8"));
  } catch {
    return [];
  }
  return rows.filter((r) => (r["推薦季度"] || "").includes(event));
}

// Google Maps key for backend-side hours verification (promo fast path).
// Same key the agent's MCP server uses; read it from the hermes config.
const MAPS_KEY =
  process.env.GOOGLE_MAPS_API_KEY ||
  (() => {
    try {
      const cfg = fs.readFileSync(
        path.join(os.homedir(), ".hermes", "config.yaml"),
        "utf8"
      );
      const m = cfg.match(/GOOGLE_MAPS_API_KEY:\s*"?([A-Za-z0-9_-]+)"?/);
      return m ? m[1] : "";
    } catch {
      return "";
    }
  })();

function fetchJson(url, ms = 4000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal })
    .then((r) => r.json())
    .finally(() => clearTimeout(t));
}

// Deterministic rotation: pick the n least-recommended shops of an event
// (distribution log counts ascending, CSV order as tiebreak). Each click
// records its picks, so the next click naturally rotates to other shops.
function pickPromoShops(event, n = 3) {
  const rows = rowsForEvent(event);
  const counts = readLog();
  return rows
    .map((r, i) => ({ r, i, c: counts[r["餐廳名稱"]] || 0 }))
    .sort((a, b) => a.c - b.c || a.i - b.i)
    .slice(0, n)
    .map((x) => x.r);
}

// Verify one shop's rating + opening hours directly against Google Places
// (backend-side, ~1s, in parallel) so the model needs ZERO tool calls.
async function verifyShop(row) {
  const base = {
    name: row["餐廳名稱"],
    district: row["行政區"],
    address: row["地址"] || "",
  };
  if (!MAPS_KEY) return { ...base, verified: false };
  try {
    const q = encodeURIComponent(`${base.name} 台南`);
    const s = await fetchJson(
      `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${q}&language=en&key=${MAPS_KEY}`
    );
    const first = s.results && s.results[0];
    if (!first) return { ...base, verified: false };
    const d = await fetchJson(
      `https://maps.googleapis.com/maps/api/place/details/json?place_id=${first.place_id}&fields=rating,opening_hours,url&language=en&key=${MAPS_KEY}`
    );
    const res = d.result || {};
    const oh = res.opening_hours || {};
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Taipei",
      weekday: "long",
    }).format(new Date());
    const todayLine =
      (oh.weekday_text || []).find((l) => l.startsWith(weekday)) || "";
    return {
      ...base,
      verified: true,
      rating: res.rating || first.rating || "",
      openNow:
        oh.open_now === true
          ? "OPEN NOW"
          : oh.open_now === false
            ? "CLOSED NOW"
            : "UNKNOWN",
      todayHours: todayLine.replace(`${weekday}: `, ""),
      url: res.url || "",
    };
  } catch {
    return { ...base, verified: false };
  }
}

function getPromotions() {
  let rows;
  try {
    rows = parseCsv(fs.readFileSync(MANGO_CSV, "utf8"));
  } catch (e) {
    console.error("promotions read failed:", e.message);
    return [];
  }
  const month = taipeiMonth();
  const byEvent = new Map();
  for (const r of rows) {
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
    const meta =
      EVENT_META[event] || {
        label: event,
        emoji: "🎉",
        blurb: `${event} is happening in Tainan right now.`,
        query: `What's good for ${event} near me right now?`,
      };
    // Fixed default: always the first 4 shops in CSV order (stable banner;
    // the city controls the lineup simply by ordering the CSV).
    const featured = shops.slice(0, 4);
    promos.push({ event, month, ...meta, shops: featured });
  }
  return promos;
}

// ── Hermes runner ─────────────────────────────────────────────────────
function clean(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trim();
}

function runHermes(message, hermesSessionId) {
  return new Promise((resolve, reject) => {
    const args = ["chat", "-q", message, "-Q"];
    if (hermesSessionId) args.push("--resume", hermesSessionId);

    const child = spawn(HERMES_BIN, args, {
      cwd: WORKDIR,
      env: { ...process.env, PATH: CHILD_PATH },
    });

    let stdout = "";
    let stderr = "";
    let done = false;

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      child.kill("SIGKILL");
      reject(new Error("hermes timed out"));
    }, REQUEST_TIMEOUT_MS);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("error", (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const m = stderr.match(/session_id:\s*(\S+)/);
      const newSessionId = m ? m[1] : hermesSessionId || null;
      const reply = clean(stdout);
      if (!reply && code !== 0) {
        return reject(new Error(`hermes exited ${code}: ${stderr.slice(-500)}`));
      }
      resolve({ reply, hermesSessionId: newSessionId });
    });
  });
}

// ── Demo-mode responder (scripted brain, LIVE Google Places data) ─────
// Replaces the Hermes/Gemini call for demos: quick-bite queries hit the
// Places API directly (real ratings + real opening hours) and respect the
// fair-distribution avoid-list, so the two-window anti-queue demo is genuine.
// Only the itinerary conversation is canned.

const mockState = new Map(); // sessionId -> "awaiting-itinerary-profile"

const CRAVING_MAP = [
  [/beef|牛肉/i, "牛肉湯"],
  [/mango|芒果/i, "芒果冰"],
  [/seafood|海鮮/i, "海鮮餐廳"],
  [/oyster|蚵仔|蚵/i, "蚵仔煎"],
  [/milkfish|虱目魚/i, "虱目魚粥"],
  [/shrimp|蝦仁/i, "蝦仁飯"],
  [/dumpling|水餃|餃/i, "水餃"],
  [/noodle|擔仔|麵/i, "擔仔麵"],
  [/breakfast|早餐/i, "台式傳統早餐"],
  [/dessert|shaved ice|冰店|剉冰/i, "冰店"],
  [/coffee|咖啡/i, "咖啡廳"],
  [/bar|cocktail|酒吧|喝酒/i, "酒吧"],
  [/surprise/i, "台南小吃"],
];

function districtOf(addr = "") {
  const zh = addr.match(/([一-鿿]{1,2}區)/);
  if (zh) return zh[1];
  const en = addr.match(/([A-Za-z][A-Za-z' ]*?District)/);
  return en ? en[1] : "台南";
}

function hoursLineOf(v) {
  if (!v.verified || v.openNow === "UNKNOWN")
    return "Opening hours: check the map";
  if (v.openNow === "OPEN NOW")
    return `Open now · today ${v.todayHours || "hours on the map"}`;
  return `Closed right now · today ${v.todayHours || "hours on the map"}`;
}

// One reply "card block" in the exact shape frontend/src/reply.js parses.
function cardBlock(v, i, descLine) {
  const lines = [
    `${i + 1}. ${v.name} ⭐${v.rating || "—"} ${v.district}`,
    descLine || v.address || "",
    hoursLineOf(v),
  ];
  if (v.url) lines.push(v.url);
  return lines.filter(Boolean).join("\n");
}

// LIVE search: Places textsearch → skip recently-recommended shops → verify
// opening hours for the survivors. This is the real anti-queue engine.
async function liveShopCards(query, avoid, n = 3) {
  if (!MAPS_KEY) return [];
  const s = await fetchJson(
    `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(
      query + " 台南"
    )}&language=en&key=${MAPS_KEY}`
  ).catch(() => ({}));
  const isAvoided = (name) =>
    avoid.some((a) => name.includes(a) || a.includes(name));
  const pool = (s.results || [])
    .filter((r) => (r.rating || 0) >= 4.0 && (r.user_ratings_total || 0) >= 50)
    .filter((r) => r.business_status !== "CLOSED_PERMANENTLY")
    .filter((r) => !isAvoided(r.name))
    // Shops open right now first, then by rating — "now" should mean now.
    .sort(
      (a, b) =>
        ((b.opening_hours && b.opening_hours.open_now) === true) -
          ((a.opening_hours && a.opening_hours.open_now) === true) ||
        (b.rating || 0) - (a.rating || 0)
    )
    .slice(0, n);
  return Promise.all(
    pool.map(async (r) => {
      const d = await fetchJson(
        `https://maps.googleapis.com/maps/api/place/details/json?place_id=${r.place_id}&fields=rating,opening_hours,url&language=en&key=${MAPS_KEY}`
      ).catch(() => ({}));
      const res = (d && d.result) || {};
      const oh = res.opening_hours || {};
      const weekday = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Taipei",
        weekday: "long",
      }).format(new Date());
      const todayLine =
        (oh.weekday_text || []).find((l) => l.startsWith(weekday)) || "";
      return {
        name: r.name,
        district: districtOf(r.formatted_address),
        address: r.formatted_address || "",
        rating: res.rating || r.rating || "",
        verified: true,
        openNow:
          oh.open_now === true
            ? "OPEN NOW"
            : oh.open_now === false
              ? "CLOSED NOW"
              : "UNKNOWN",
        todayHours: todayLine.replace(`${weekday}: `, ""),
        url: res.url || "",
      };
    })
  );
}

const NEXT_LINE = "Next? · another dish · full day plan · I'm all set";

const CANNED_ITINERARY = [
  "Here's your Tainan food day — spread across different spots so you're never stuck in a queue:",
  "",
  "1. 阿堂鹹粥 ⭐4.2 中西區",
  "08:00 breakfast · milkfish congee, a Tainan institution — go early, it sells out",
  "Opens 06:00 · closes early afternoon",
  "https://www.google.com/maps/search/?api=1&query=" +
    encodeURIComponent("阿堂鹹粥 台南"),
  "",
  "2. 邱家小卷米粉 ⭐4.4 中西區",
  "12:00 lunch · squid rice-noodle soup, the definitive bowl",
  "Opens 11:00 · sells out by ~15:00",
  "https://www.google.com/maps/search/?api=1&query=" +
    encodeURIComponent("邱家小卷米粉 台南"),
  "",
  "3. 蜷尾家甘味処 ⭐4.4 中西區",
  "15:00 dessert · cult soft-serve on 正興街",
  "Opens 11:00 · afternoon queues move fast",
  "https://www.google.com/maps/search/?api=1&query=" +
    encodeURIComponent("蜷尾家 台南"),
  "",
  "4. 阿江炒鱔魚 ⭐4.1 中西區",
  "18:00 dinner · wok-fried eel noodles over charcoal, pure old-Tainan",
  "Opens 17:00 · dinner only",
  "https://www.google.com/maps/search/?api=1&query=" +
    encodeURIComponent("阿江炒鱔魚意麵 台南"),
  "",
  "5. Bar TCRC ⭐4.4 中西區",
  "21:00 drinks · one of Asia's 50 Best Bars, in a restored old house",
  "Opens 20:00 · put your name down early",
  "https://www.google.com/maps/search/?api=1&query=" +
    encodeURIComponent("Bar TCRC 台南"),
  "",
  "🗺️ Full walking route: https://www.google.com/maps/dir/" +
    ["阿堂鹹粥", "邱家小卷米粉", "蜷尾家甘味処", "阿江炒鱔魚意麵", "Bar TCRC 台南"]
      .map(encodeURIComponent)
      .join("/"),
  "",
  "Next? · swap a stop · quick bite instead · I'm all set",
].join("\n");

async function mockReply({ sessionId, message, promo, avoid }) {
  const msg = message.toLowerCase();

  // Official campaign button: backend already picked + verified partner shops
  // (deterministic rotation) — just format them.
  if (promo) {
    // Verify twice as many rotation picks as we show, then prefer open shops.
    const picks = pickPromoShops(promo, 6);
    const verified = (await Promise.all(picks.map((r) => verifyShop(r))))
      .sort(
        (a, b) => (b.openNow === "OPEN NOW") - (a.openNow === "OPEN NOW")
      )
      .slice(0, 3);
    const meta = EVENT_META[promo] || { emoji: "🎉" };
    const cards = verified.map((v, i) =>
      cardBlock({ ...v, district: v.district || districtOf(v.address) }, i)
    );
    return (
      `${meta.emoji} Official ${meta.label || promo} partner shops — data verified seconds ago, ` +
      `rotated so every partner gets its share of visitors:\n\n` +
      cards.join("\n\n")
    ); // the promo Next-line is enforced by the route
  }

  // Itinerary flow: canned two-step conversation.
  if (mockState.get(sessionId) === "awaiting-itinerary-profile") {
    mockState.delete(sessionId);
    return CANNED_ITINERARY;
  }
  if (/full day plan|day plan|swap a stop/i.test(msg)) return CANNED_ITINERARY;
  if (/itinerary|行程/i.test(msg)) {
    mockState.set(sessionId, "awaiting-itinerary-profile");
    return [
      "Love it — a proper Tainan food day! Two quick questions:",
      "",
      "1. Which area are you staying in (中西區, 安平…)? ",
      "2. Any dietary needs — vegetarian, no beef, no alcohol?",
      "",
      "Next? · 中西區, no restrictions · vegetarian friendly · no alcohol please",
    ].join("\n");
  }

  // Quick-bite intro button.
  if (/quick bite/i.test(msg) && !CRAVING_MAP.some(([re]) => re.test(msg))) {
    return [
      "Sure! Tell me two things:",
      "",
      "· What are you craving? (beef soup, mango ice, seafood…)",
      "· Where are you? (a district like 中西區, or a landmark)",
      "",
      "Next? · beef soup near 中西區 now · mango shaved ice · surprise me",
    ].join("\n");
  }

  if (/i'm all set|all set|thanks|謝謝/i.test(msg)) {
    return "Enjoy Tainan — and if the line looks long anywhere, come back and I'll route you somewhere just as good with no wait. 🍜";
  }

  // Craving → LIVE Google Places search with fair-distribution rotation.
  // Only search when the message actually reads like a food request, so
  // greetings/small talk don't textsearch random businesses.
  const hit = CRAVING_MAP.find(([re]) => re.test(message));
  const districtM = message.match(/([一-鿿]{1,2}區)/);
  const foodish =
    !!districtM ||
    /eat|food|hungry|restaurant|lunch|dinner|snack|spot|想吃|好吃|餐廳|小吃/i.test(
      message
    );
  const wantOne = /one pick|just one|一家/i.test(message);
  const query = (hit ? hit[1] : message) + (districtM ? " " + districtM[1] : "");
  const shops =
    hit || foodish ? await liveShopCards(query, avoid, wantOne ? 1 : 3) : [];
  if (shops.length) {
    const intro = hit
      ? `Here you go — ${hit[1]} spots with great ratings, checked against live opening hours${
          avoid.length ? ", and steered away from shops other visitors were just sent to" : ""
        }:`
      : "Here's what I found nearby, checked against live opening hours:";
    return (
      intro +
      "\n\n" +
      shops.map((v, i) => cardBlock(v, i)).join("\n\n") +
      "\n\n" +
      NEXT_LINE
    );
  }

  // Fallback greeting / unrecognized input.
  return [
    "Hi! I'm your Tainan food concierge 🍜 I check live opening hours and spread visitors across equally great shops, so nobody wastes their trip in a queue.",
    "",
    "Next? · beef soup near 中西區 now · mango shaved ice · full day plan",
  ].join("\n");
}

// ── Routes ────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ ok: true, sessions: sessions.size, distribution: readLog() });
});

app.get("/promotions", (_req, res) => {
  res.json({ promotions: getPromotions() });
});

app.post("/chat", async (req, res) => {
  const { sessionId, message, promo } = req.body || {};
  if (!sessionId || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "sessionId and message are required" });
  }

  // Inject context the agent would otherwise burn a model roundtrip to fetch:
  // 1) current Tainan time (saves it running `date` via the terminal tool)
  // 2) cross-user fair-distribution note (reliable, backend-managed)
  const now = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "long",
    hour12: false,
  }).format(new Date());
  let notes = `(Current Tainan time: ${now} — use this as "now", don't run date.)`;
  const avoid = avoidList();
  const isPromo = !!(promo && typeof promo === "string");

  // Demo mode: scripted brain + live Places data; skips Hermes entirely but
  // keeps the same post-processing (promo Next-line, distribution log, badge).
  if (MOCK_MODE) {
    try {
      let finalReply = await mockReply({
        sessionId,
        message,
        promo: isPromo ? promo : null,
        avoid,
      });
      if (isPromo) {
        const PROMO_NEXT =
          "Next? · different spots · full day plan · I'm all set";
        if (/^next[?:]/im.test(finalReply)) {
          finalReply = finalReply.replace(/^next[?:].*$/im, PROMO_NEXT);
        } else {
          finalReply = finalReply.trimEnd() + "\n\n" + PROMO_NEXT;
        }
      }
      const shops = extractShops(finalReply);
      bumpShops(shops);
      return res.json({
        reply: finalReply || "(no reply)",
        sessionId,
        balanced: avoid.length > 0 && shops.length > 0,
      });
    } catch (err) {
      console.error("[/chat mock] error:", err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // Generic fair-distribution nudge (skipped in promo mode, where the backend
  // already picks shops deterministically by rotation).
  if (avoid.length && !isPromo) {
    notes +=
      `\n(Fair-distribution note: these shops were already recommended to other users ` +
      `recently — prefer DIFFERENT equally-good, currently-open shops when you can: ` +
      `${avoid.join(", ")}.)`;
  }
  // Official campaign fast path: the backend picks the 3 least-recommended
  // partner shops (deterministic rotation) and verifies their hours directly
  // against Google Places (~1s, parallel). The model gets ready-made data and
  // does ZERO tool calls, just formatting. Cuts latency from ~25-30s to ~10-12s
  // and eliminates the tool-failure/leak failure mode entirely.
  if (isPromo) {
    const picks = pickPromoShops(promo, 3);
    if (picks.length) {
      const verified = await Promise.all(picks.map((r) => verifyShop(r)));
      const lines = verified.map(
        (v, i) =>
          `${i + 1}. ${v.name} | ${v.district} | ${v.address} | rating: ${
            v.verified && v.rating ? v.rating : "n/a"
          } | status: ${
            v.verified
              ? `${v.openNow}, today's hours: ${v.todayHours || "no hours listed today"}`
              : "UNVERIFIED"
          }${v.url ? ` | map: ${v.url}` : ""}`
      );
      notes +=
        `\n(OFFICIAL ${promo} CAMPAIGN MODE. Present EXACTLY these ${verified.length} shops, ` +
        `in this order, using the standard card format. All data below was verified seconds ago:\n` +
        lines.join("\n") +
        `\nFormat rules: headline is name then ⭐rating then district (skip the star part if rating ` +
        `is n/a). Second line is the address. Third line is the opening status: if OPEN NOW write ` +
        `"Open until <closing time> today" using today's hours; if CLOSED NOW write "Currently ` +
        `closed" and when it opens if today's hours show it; if UNVERIFIED write "Check hours on ` +
        `the map". Include the map link on its own line when provided. Do NOT call any tools. ` +
        `Do NOT change, add, or reorder shops. ` +
        `End with exactly: Next? · different spots · full day plan · I'm all set)`;
    }
  }
  const outgoing = `${notes}\n\n${message.trim()}`;

  // Rotate to a fresh hermes session after TURN_LIMIT turns (keeps latency flat).
  let entry = sessions.get(sessionId) || null;
  if (entry && entry.turns >= TURN_LIMIT) {
    console.log(
      `[/chat] session ${sessionId} hit ${TURN_LIMIT} turns — rotating to a fresh hermes session`
    );
    entry = null;
  }
  const hermesSessionId = entry ? entry.hermesSessionId : null;
  try {
    const { reply, hermesSessionId: newId } = await runHermes(
      outgoing,
      hermesSessionId
    );
    if (newId)
      sessions.set(sessionId, {
        hermesSessionId: newId,
        turns: (entry ? entry.turns : 0) + 1,
      });
    // Campaign mode: enforce the two-option Next line deterministically
    // (the model sometimes falls back to the generic four options).
    let finalReply = reply;
    if (promo) {
      const PROMO_NEXT = "Next? · different spots · full day plan · I'm all set";
      if (/^next[?:]/im.test(finalReply)) {
        finalReply = finalReply.replace(/^next[?:].*$/im, PROMO_NEXT);
      } else {
        finalReply = finalReply.trimEnd() + "\n\n" + PROMO_NEXT;
      }
    }
    // Record whatever shops this reply recommended, for the next user.
    const shops = extractShops(finalReply);
    bumpShops(shops);
    // "balanced" = this reply recommended shops while an avoid-list was active,
    // i.e. the fair-distribution engine steered it. The UI shows a badge.
    res.json({
      reply: finalReply || "(no reply)",
      sessionId,
      balanced: avoid.length > 0 && shops.length > 0,
    });
  } catch (err) {
    console.error("[/chat] error:", err.message);
    if (/timed out/i.test(err.message)) {
      // Self-heal: the bloated session is the usual culprit — drop it so the
      // user's retry starts a fresh, fast conversation.
      sessions.delete(sessionId);
      return res.status(500).json({
        error:
          "That took too long, so I reset the conversation — please try again (it will be fast now).",
      });
    }
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🍜 Tainan Food Concierge backend on http://localhost:${PORT}`);
  console.log(
    MOCK_MODE
      ? `   mode: 🎭 DEMO (scripted brain + live Google Places; MOCK_MODE=0 for Hermes)`
      : `   mode: hermes (${HERMES_BIN})`
  );
  console.log(`   distribution log: ${DIST_LOG}`);
});

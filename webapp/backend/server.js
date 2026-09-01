// Tainan Food Concierge — backend
// Exposes POST /chat, GET /promotions, GET /health for the React frontend.
//
// Two brains, picked at startup:
//   • agent mode (default when ANTHROPIC_API_KEY is set) — agent.js, a real
//     agentic loop on the Claude API with Google Places tools.
//   • demo mode (no key, or DEMO_MODE=1) — demo.js, a scripted responder
//     that still serves live Places data so the UI works without any LLM key.
//
// CROSS-USER FAIR DISTRIBUTION (backend-managed, so it's reliable — we don't
// depend on the model remembering to call a tool):
//   • Before each turn we read a shared log of shops already recommended to
//     OTHER users, and inject an "avoid these" note into the message so two
//     users asking for the same dish get routed to different shops.
//   • After each reply we parse the shop names out of it and record them.
//   The log holds only shop names + counts (not personal data), so sharing it
//   across sessions is intentional — unlike the per-chat dietary profile.

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const express = require("express");
const cors = require("cors");
const { readLog, bumpShops, avoidList } = require("./lib/distlog");
const { verifyShop } = require("./lib/maps");
const { getPromotions, pickPromoShops } = require("./lib/events");
const { mockReply } = require("./demo");

const PORT = process.env.PORT || 8787;
const DEMO_MODE =
  process.env.DEMO_MODE === "1" ||
  (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN);

// Load the agent lazily so demo mode runs without the Anthropic SDK configured.
const agent = DEMO_MODE ? null : require("./agent");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Pull shop names out of a reply. Recommendation lines look like:
//   "1. 豪牛牛肉湯 (Hao Niu Beef Soup) — 中西區 · ⭐4.9 ..."
// The name is the text before the first " (", " —", " ·", or "⭐".
function extractShops(reply) {
  const names = [];
  for (const raw of reply.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/^next[?:]/i.test(line)) continue; // skip the "Next?" suggestion line
    // a shop headline carries the star rating (card format) or a maps link
    if (!/⭐|stars|maps\.google|maps\/place|google\.com\/maps/i.test(line)) continue;
    let name = line.replace(/^\s*\d+[.)]\s*/, "").replace(/\*\*/g, "");
    name = name.split(/\s*[（(]|\s*⭐| — | – | · /)[0].trim();
    if (name.length >= 2 && name.length <= 40 && !/^https?:/i.test(name)) {
      names.push(name);
    }
  }
  return [...new Set(names)];
}

const PROMO_NEXT = "Next? · different spots · full day plan · I'm all set";

function enforcePromoNextLine(reply) {
  if (/^next[?:]/im.test(reply)) {
    return reply.replace(/^next[?:].*$/im, PROMO_NEXT);
  }
  return reply.trimEnd() + "\n\n" + PROMO_NEXT;
}

// ── Routes ────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ ok: true, mode: DEMO_MODE ? "demo" : "agent", distribution: readLog() });
});

app.get("/promotions", (_req, res) => {
  res.json({ promotions: getPromotions() });
});

app.post("/chat", async (req, res) => {
  const { sessionId, message, promo } = req.body || {};
  if (!sessionId || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "sessionId and message are required" });
  }
  const isPromo = !!(promo && typeof promo === "string");
  const avoid = avoidList();

  try {
    let reply;

    if (DEMO_MODE) {
      reply = await mockReply({
        sessionId,
        message,
        promo: isPromo ? promo : null,
        avoid,
      });
    } else {
      // Inject context the agent would otherwise burn a tool roundtrip on:
      // current Tainan time, the fair-distribution note, and (for campaign
      // clicks) pre-verified partner-shop data. All volatile context goes in
      // the user turn — the system prompt stays stable for prompt caching.
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
      let notes = `(Current Tainan time: ${now} — use this as "now".)`;

      if (avoid.length && !isPromo) {
        notes +=
          `\n(Fair-distribution note: these shops were already recommended to other users ` +
          `recently — prefer DIFFERENT equally-good, currently-open shops when you can: ` +
          `${avoid.join(", ")}.)`;
      }

      // Official campaign fast path: the backend picks the 3 least-recommended
      // partner shops (deterministic rotation) and verifies their hours
      // directly against Google Places (~1s, in parallel). The model gets
      // ready-made data and does ZERO tool calls — just formatting.
      if (isPromo) {
        const picks = pickPromoShops(promo, readLog(), 3);
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
            `\nDo NOT call any tools. Do NOT change, add, or reorder shops. ` +
            `End with exactly: ${PROMO_NEXT})`;
        }
      }

      reply = await agent.runAgent(sessionId, `${notes}\n\n${message.trim()}`);
    }

    if (isPromo) reply = enforcePromoNextLine(reply);

    // Record whatever shops this reply recommended, for the next user.
    // "balanced" = shops were recommended while an avoid-list was active,
    // i.e. the fair-distribution engine steered this reply (UI shows a badge).
    const shops = extractShops(reply);
    bumpShops(shops);
    res.json({
      reply: reply || "(no reply)",
      sessionId,
      balanced: avoid.length > 0 && shops.length > 0,
    });
  } catch (err) {
    console.error("[/chat] error:", err.message);
    if (!DEMO_MODE) agent.resetSession(sessionId); // self-heal: retry starts fresh
    res.status(500).json({
      error: "Something went wrong on my side — please try that again.",
    });
  }
});

app.listen(PORT, () => {
  console.log(`🍜 Tainan Food Concierge backend on http://localhost:${PORT}`);
  console.log(
    DEMO_MODE
      ? `   mode: 🎭 DEMO (scripted brain + live Google Places; set ANTHROPIC_API_KEY for the real agent)`
      : `   mode: 🤖 agent (${agent.MODEL})`
  );
});

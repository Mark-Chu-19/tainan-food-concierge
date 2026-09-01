// Demo-mode responder — the no-API-key fallback.
// The LLM brain is replaced by a scripted responder so anyone can clone the
// repo and click around the UI, but shop data is still LIVE when a Google
// Maps key is present (real ratings, real opening hours), and the
// fair-distribution rotation runs for real. Only the itinerary conversation
// is canned. With ANTHROPIC_API_KEY set, server.js uses the real agent
// (agent.js) instead of this file.

const { searchPlaces, placeDetails, districtOf, verifyShop } = require("./lib/maps");
const { pickPromoShops, EVENT_META } = require("./lib/events");
const { readLog } = require("./lib/distlog");

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

function hoursLineOf(v) {
  const openNow = v.openNow ?? (v.open_now === true ? "OPEN NOW" : v.open_now === false ? "CLOSED NOW" : "UNKNOWN");
  const today = v.todayHours || v.today_hours || "";
  if (openNow === "UNKNOWN") return "Opening hours: check the map";
  if (openNow === "OPEN NOW") return `Open now · today ${today || "hours on the map"}`;
  return `Closed right now · today ${today || "hours on the map"}`;
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
// opening hours for the survivors. The real anti-queue engine, sans LLM.
async function liveShopCards(query, avoid, n = 3) {
  let pool;
  try {
    pool = await searchPlaces(query, { limit: 12 });
  } catch {
    return [];
  }
  const isAvoided = (name) =>
    avoid.some((a) => name.includes(a) || a.includes(name));
  const picked = pool
    .filter((r) => !isAvoided(r.name))
    // Shops open right now first, then by rating — "now" should mean now.
    .sort(
      (a, b) =>
        (b.open_now === true) - (a.open_now === true) ||
        (b.rating || 0) - (a.rating || 0)
    )
    .slice(0, n);
  return Promise.all(
    picked.map(async (r) => {
      try {
        const d = await placeDetails(r.place_id);
        return { ...r, ...d, name: r.name, district: r.district };
      } catch {
        return r;
      }
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
    const picks = pickPromoShops(promo, readLog(), 6);
    const verified = (await Promise.all(picks.map((r) => verifyShop(r))))
      .sort((a, b) => (b.openNow === "OPEN NOW") - (a.openNow === "OPEN NOW"))
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

module.exports = { mockReply };

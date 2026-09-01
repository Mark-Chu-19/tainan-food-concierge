// The agent brain: a hand-rolled agentic loop on the Claude API.
//   user message → Claude → (parallel) tool calls → results → Claude → … → reply
// Claude decides which tools to call and when; the backend only executes them.
// Tools are thin wrappers over live Google Places data and the city event
// layer, so every rating and opening hour in a reply is real, fetched seconds
// ago. Cross-user fair distribution stays backend-managed (see server.js) —
// it is injected as context rather than left to the model to remember.

const Anthropic = require("@anthropic-ai/sdk");
const { searchPlaces, placeDetails } = require("./lib/maps");
const { getPromotions } = require("./lib/events");

const MODEL = process.env.AGENT_MODEL || "claude-opus-5";
const EFFORT = process.env.AGENT_EFFORT || "low"; // chat is latency-sensitive
const MAX_TOOL_ITERATIONS = 8;
const MAX_HISTORY_MESSAGES = 24;

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

// ── System prompt ─────────────────────────────────────────────────────
// Stable by design: all volatile context (current time, fair-distribution
// avoid-list, campaign data) is injected into the user turn by server.js, so
// this block stays byte-identical and prompt caching keeps input costs low.
const SYSTEM_PROMPT = `You are the Tainan Food Concierge — a warm, fast city guide for foreign visitors to Tainan, Taiwan. You check LIVE opening hours and deliberately spread visitors across equally great shops, so nobody wastes their trip standing in a queue and every good shop in the district gets its share of customers.

Default to English; mirror the user's language if they write in another one. Always give dish and shop names bilingually (牛肉湯 / beef soup) so users can order on site.

## Tools
- search_places: text search for shops (already quality-filtered, with district and a rough open-now flag).
- get_place_details: verified rating, open-now status, TODAY's hours, and a Google Maps URL for one shop. When you shortlist shops, call get_place_details for ALL of them in a SINGLE turn (parallel tool calls) — never one at a time.
- get_city_events: the city's active seasonal campaigns and partner shops this month.

Keep tool use lean: one search per craving, details for at most 3–4 shortlisted shops, then answer. The user is hungry and waiting.

## Time
The current Tainan date/time is injected at the top of each user message. Use it as "now". Only recommend shops open at the relevant time; if the user asks at 02:00 and nothing fits, say so and name the earliest opener. Never fabricate hours — if details are missing, say "check the map" rather than inventing a time.

## Fair distribution (the product's core — apply silently)
The message may include a fair-distribution note listing shops recently recommended to OTHER users. Steer this user to DIFFERENT, equally good, currently open shops. You may add one friendly line like "sending you here to skip the queues — just as good, less crowded", but never explain the mechanism or mention other users. Never collapse to the single top-rated shop when good alternatives exist; if only one shop qualifies, be honest about it.

## Campaign mode
If the message contains an OFFICIAL CAMPAIGN note with pre-verified shop data, present EXACTLY those shops in that order using the card format — no tool calls, no additions, no reordering.

## Two conversation modes
1. Quick bite — the user wants one thing now. If craving or location is missing, ask ONE short question at most; otherwise search, verify, and answer with 2–3 picks.
2. Food itinerary — the user wants a day plan. Ask at most TWO quick questions (area + dietary limits/alcohol), then build a time-ordered plan: breakfast → lunch → afternoon dessert/coffee → dinner → night bar (skip the bar unless they drink). Verify each stop is open in its slot. End the plan with one Google Maps walking-route link chaining all stops in order:
   https://www.google.com/maps/dir/<stop1>/<stop2>/... (URL-encode each "<shop name> 台南").

## Reply format (the UI parses this — follow it exactly)
Each recommended shop is one card block, blocks separated by a blank line:

1. 阿村牛肉湯 (A-Cun Beef Soup) ⭐4.5 中西區
One line on why this shop — its signature dish, what makes it special.
Open now · today 06:00–13:00
https://maps.google.com/?cid=...

Rules: the headline is number, name (English), ⭐rating, district — nothing else. The hours line must start with "Open", "Opens", "Closed", or "Opening hours". Put the Google Maps URL on its own line (use the URL from get_place_details when you have it, else https://www.google.com/maps/search/?api=1&query=<name>, Tainan). For itineraries, prefix the "why" line with the time slot (e.g. "08:00 breakfast · milkfish congee, a Tainan institution").

End EVERY reply with exactly one suggestion line for the UI's tap chips:
Next? · <option> · <option> · <option>
Keep options short and contextual (e.g. "another dish", "full day plan", "different picks", "I'm all set").

Keep intros to one or two sentences. Be honest: real data only, no invented shops, ratings, or hours.`;

// ── Tool definitions ──────────────────────────────────────────────────
const TOOLS = [
  {
    name: "search_places",
    description:
      "Search Tainan for food/drink shops (Google Places, quality pre-filtered: rating ≥4.0, ≥50 reviews, not permanently closed). Query in Chinese works best, e.g. '牛肉湯 中西區' or '素食 安平'. Returns name, place_id, rating, review count, district, and a rough open-now flag.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "What to search, optionally with a district, e.g. '芒果冰 中西區'",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "get_place_details",
    description:
      "Verified live data for ONE shop by place_id: rating, open-now status, today's opening hours, and its Google Maps URL. Call this for all shortlisted shops in parallel (multiple tool calls in one turn).",
    input_schema: {
      type: "object",
      properties: {
        place_id: { type: "string", description: "place_id from search_places" },
      },
      required: ["place_id"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "get_city_events",
    description:
      "The city's seasonal food campaigns active this month (e.g. Mango Season), each with its official partner shops. Use to boost or theme recommendations when relevant.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
    strict: true,
  },
];

async function executeTool(name, input) {
  switch (name) {
    case "search_places":
      return searchPlaces(input.query);
    case "get_place_details":
      return placeDetails(input.place_id);
    case "get_city_events":
      return getPromotions().map(({ event, label, shops }) => ({
        event,
        label,
        partner_shops: shops,
      }));
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

// ── Per-session conversation history ──────────────────────────────────
// browserSessionId → MessageParam[] (full content blocks, thinking included,
// so they replay correctly on the same model). Dietary preferences live only
// here — new chat, fresh customer.
const sessions = new Map();

function hasToolResult(msg) {
  return (
    Array.isArray(msg.content) &&
    msg.content.some((b) => b.type === "tool_result")
  );
}

// Cap history so long-lived sessions don't accumulate fat tool results.
// Trim from the front to a clean user turn — never orphan a tool_use/
// tool_result pair, which the API rejects.
function trimHistory(messages) {
  let msgs = messages.slice(-MAX_HISTORY_MESSAGES);
  while (msgs.length && !(msgs[0].role === "user" && !hasToolResult(msgs[0]))) {
    msgs.shift();
  }
  return msgs;
}

function resetSession(sessionId) {
  sessions.delete(sessionId);
}

// ── The agentic loop ──────────────────────────────────────────────────
async function runAgent(sessionId, userMessage) {
  const history = sessions.get(sessionId) || [];
  const messages = [...history, { role: "user", content: userMessage }];

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4096, // replies are short card lists by design
      output_config: { effort: EFFORT },
      // Refusal fallback: on a policy decline the API transparently re-runs
      // the request on a fallback model instead of returning nothing.
      betas: ["server-side-fallback-2026-06-01"],
      fallbacks: [{ model: "claude-opus-4-8" }],
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" }, // stable prefix → cache hits
        },
      ],
      tools: TOOLS,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "pause_turn") continue;

    if (response.stop_reason === "tool_use") {
      const toolUses = response.content.filter((b) => b.type === "tool_use");
      // Execute every tool call of the turn concurrently, return ALL results
      // in one user message — this is what keeps parallel calls fast.
      const results = await Promise.all(
        toolUses.map(async (tu) => {
          try {
            const out = await executeTool(tu.name, tu.input);
            return {
              type: "tool_result",
              tool_use_id: tu.id,
              content: JSON.stringify(out),
            };
          } catch (e) {
            return {
              type: "tool_result",
              tool_use_id: tu.id,
              content: `Error: ${e.message}`,
              is_error: true,
            };
          }
        })
      );
      messages.push({ role: "user", content: results });
      continue;
    }

    // end_turn (or refusal / max_tokens) — the turn is over.
    sessions.set(sessionId, trimHistory(messages));
    if (response.stop_reason === "refusal") {
      return "Sorry — I can't help with that one. Ask me anything about eating well in Tainan! 🍜";
    }
    return response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
  }

  // Loop guard tripped — persist what happened and fail loudly.
  sessions.set(sessionId, trimHistory(messages));
  throw new Error(`agent exceeded ${MAX_TOOL_ITERATIONS} tool iterations`);
}

module.exports = { runAgent, resetSession, MODEL };

# Tainan Food Concierge 🍜

An AI agent that helps foreign visitors eat well in Tainan, Taiwan — and quietly solves a city-scale problem while doing it.

> Tainan's most famous beef-soup shop has a 2-hour queue. The equally-rated shop next door is empty. Tourists cluster on the #1 search result: visitors waste their trip standing in line, and 90% of great shops never see the tourism money. This agent is a **city food concierge with a fair-distribution engine** — it routes each visitor to a different, equally good, currently-open shop, spreading demand across the whole district.

Built for a smart-city hackathon; since rebuilt as a self-contained, open-source project.

## What it does

1. **Fair distribution / anti-queue (pure algorithm).** Qualifying shops for a craving form a candidate pool. A shared, rolling-window log tracks what was just recommended to *other* users, and the next user is steered to a different equally-good shop. Two browser windows asking the same question get different answers — that's the point.
2. **City event layer.** A CSV (standing in for a city-maintained Google Sheet CMS) lists seasonal campaigns — Mango Season in July, Qigu Seafood Festival in August. Active campaigns surface as a banner and boost their partner shops, rotated so every partner gets its share of visitors.
3. **Conversational food itineraries.** A two-question intake, then a time-ordered day plan (breakfast → lunch → dessert → dinner → bar), every stop verified open in its slot, capped with a single Google Maps walking-route link chaining all stops.

All shop data is **live** — real ratings and real opening hours from the Google Places API, fetched seconds before you see them.

## Architecture

```
React frontend (Vite)
   │  POST /chat { sessionId, message }
Node/Express backend
   │  ├─ fair-distribution engine (shared rolling-window log, backend-managed)
   │  ├─ city event layer (CSV → banner + campaign fast path)
   │  └─ agent loop (agent.js) ──── Claude API (tool use)
   │        tools: search_places · get_place_details · get_city_events
   └─ Google Places API (live ratings + opening hours)
```

### The agent (`webapp/backend/agent.js`)

A hand-rolled agentic loop on the Claude API — no framework:

- **Tool use loop.** Claude decides which tools to call and when; the backend executes them and feeds results back until the model ends its turn. Parallel tool calls in one turn (e.g. verifying 3 shortlisted shops at once) are executed concurrently and returned in a single message.
- **Deliberate tool surface.** Three small, composable tools over live data — a quality-pre-filtered place search, a per-shop verifier (rating, open-now, today's hours, maps URL), and the city's active campaigns.
- **Stable system prompt, cache-friendly.** The persona, format contract, and distribution policy live in one frozen system prompt (with `cache_control`); all volatile context — current Tainan time, the avoid-list, campaign data — is injected into the user turn, so prompt caching keeps latency and cost down.
- **Reliability where it matters.** The fair-distribution engine is *backend-managed*, not model-managed: the avoid-list is injected deterministically before each turn and recommended shops are parsed and recorded after it. The model is never trusted to remember to call a bookkeeping tool.
- **Campaign fast path.** When a user taps an official-campaign banner, the backend itself picks the least-recommended partner shops (deterministic rotation), verifies their hours in parallel (~1s), and hands the model ready-made data with zero tool calls — just formatting.
- **Session memory with privacy by design.** Conversation history (dietary needs included) lives per browser session and dies with it; the shared distribution log holds only shop names and timestamps in a 2-hour rolling window. New chat = fresh customer.
- **Demo fallback.** Without an `ANTHROPIC_API_KEY`, the backend serves a scripted responder over the same live Places data — the UI, rotation, and city dashboard all still work, so the project is clickable with zero LLM cost.

The `skills/` folder contains the original behavior specs (authored as agent skills during the hackathon); their logic is now consolidated into the agent's system prompt and tools.

## Quickstart

Requires Node 18+, an [Anthropic API key](https://console.anthropic.com/), and a Google Maps API key with the **Places API** enabled.

```bash
# 1. Configure the backend
cp webapp/backend/.env.example webapp/backend/.env
#    → fill in ANTHROPIC_API_KEY and GOOGLE_MAPS_API_KEY

# 2. (Optional) map cards in the UI
cp webapp/frontend/.env.example webapp/frontend/.env

# 3. Run both (installs deps on first run)
bash webapp/start.sh
#    → open the Vite URL it prints (usually http://localhost:5173)
```

No Anthropic key? It still runs — in scripted demo mode (live shop data if the Maps key is set).

### See the fair distribution work

```bash
node tools/distlog.mjs reset        # start clean
```

Open **two browser windows** (each is its own session) and ask both: `beef soup near 中西區 now`. The second window gets **different shops** and a 🌊 badge — the engine knows other visitors were just routed to the first set. Inspect the shared log anytime with `node tools/distlog.mjs get`, and see the city's view via the 🏙️ dashboard in the UI.

## Configuration

| Variable | Where | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | `webapp/backend/.env` | Claude agent (empty → demo mode) |
| `GOOGLE_MAPS_API_KEY` | `webapp/backend/.env` | Live Places data (Places API enabled) |
| `CLAUDE_MODEL` / `CLAUDE_EFFORT` | `webapp/backend/.env` | Model (default `claude-opus-5`) and effort (default `low` for snappy chat) |
| `DEMO_MODE=1` | `webapp/backend/.env` | Force the scripted fallback |
| `VITE_MAPS_KEY` | `webapp/frontend/.env` | Embedded mini-maps (optional) |

## Project layout

```
├── webapp/
│   ├── backend/
│   │   ├── server.js        # routes, fair-distribution engine, campaign fast path
│   │   ├── agent.js         # the Claude agentic loop + tools + system prompt
│   │   ├── demo.js          # no-key scripted fallback (live Places data)
│   │   └── lib/             # maps.js · events.js · distlog.js
│   └── frontend/            # React chat UI: cards, chips, city dashboard
├── data/                    # city event CSV + curated local food references
├── skills/                  # original hackathon behavior specs (design docs)
├── tools/distlog.mjs        # CLI for the shared distribution log
└── DEMO.md                  # 3-minute demo runbook
```

## Why an agent, not a form?

A foreign tourist expresses a craving, a location, and dietary limits in natural language — any language — and the agent composes live data on the fly ("vegetarian, near the train station, open *now*, and I don't drink"). The same engine generalizes beyond food: night markets, attractions, city-wide crowd distribution. Every city could use one.

## License

[MIT](LICENSE) © 2026 Mark Chu

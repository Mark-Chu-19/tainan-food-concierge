# Tainan Food Concierge — Web App

The consumer chat UI + backend for the Tainan food agent. See the [root README](../README.md) for the full story and quickstart.

```
React frontend (Vite, :5173)
   │  POST /chat { sessionId, message }  →  { reply, sessionId, balanced }
Node/Express backend  (:8787, CORS)
   │  agent.js — Claude API agentic loop (tools: places search/details, city events)
   └─ Google Places API (live ratings + opening hours)
```

## Run

```bash
cp backend/.env.example backend/.env   # fill in ANTHROPIC_API_KEY + GOOGLE_MAPS_API_KEY
bash start.sh
```

Then open the **Vite URL** it prints (e.g. http://localhost:5173).

Or run the two parts manually:

```bash
cd backend  && npm install && node server.js   # :8787
cd frontend && npm install && npm run dev      # :5173
```

### Modes

- **Agent mode** (`ANTHROPIC_API_KEY` set): the real Claude agentic loop — the model searches, verifies hours, and composes replies with live data.
- **Demo mode** (no key, or `DEMO_MODE=1`): a scripted responder over the same live Places data. The UI, fair-distribution rotation, and city dashboard all still work; only the conversation logic is canned.

## Try it

- Click **🍜 Quick bite now** → type `beef soup near 中西區 now`
- Click **🗺️ Plan a food itinerary** → answer the questions → get a day plan + map
- Tap the **Next?** chips to continue (another dish, add a bar, full plan…)

## The two-window anti-queue demo

1. Reset the shared log: `node ../tools/distlog.mjs reset`
2. Open **two browser windows** (each window = its own conversation).
3. **Window 1**: `beef soup near 中西區 now` → note the shop.
4. **Window 2**: same question → a **different** shop + the 🌊 badge.
5. Inspect the log anytime: `node ../tools/distlog.mjs get`

How it works: the backend keeps a shared, non-personal log of shops already recommended and injects an "avoid these" note into the next user's request, so the agent routes them elsewhere. The per-customer **dietary profile stays private** to each conversation — New chat = a fresh customer. Ask the two windows one after the other (a couple of seconds apart) for the cleanest effect; simultaneous sends can both read the log before either is recorded.

## Notes

- **Embedded maps** use the Google **Maps Embed API** with the key in `frontend/.env` (`VITE_MAPS_KEY`). Enable "Maps Embed API" in Google Cloud for the little maps to render; without it, the **📍 Open in Google Maps** link still works.
- Config: see the `.env.example` files in `backend/` and `frontend/` — never commit the real `.env`.

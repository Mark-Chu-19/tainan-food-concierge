# Tainan Food Concierge — Demo Web App

A custom React frontend for the Tainan food agent. The agent brain (Hermes +
Gemini + Google Maps + fair-distribution persona/skills) is reused as-is; this
app just gives it a consumer chat UI with two-mode buttons, chat bubbles,
clickable next-step chips, and embedded Google map cards.

```
React frontend (Vite, :5173/5174)
   │  POST /chat { sessionId, message }  →  { reply, sessionId }
Node/Express backend  (:8787, CORS)
   │  hermes chat -q "<message>" -Q [--resume <id>]
Hermes Tainan food agent  (unchanged)
```

## Run

```bash
bash webapp/start.sh
```
Then open the **Vite URL** it prints (e.g. http://localhost:5174).

### Demo mode (default — no LLM key needed)

The backend currently runs in **demo mode** (`MOCK_MODE`, on by default): the
Hermes/Gemini brain is replaced by a scripted responder, but **shop data is
still live** — quick-bite queries and campaign shops hit the Google Places API
directly (real ratings, real opening hours), and the fair-distribution
rotation runs for real (two windows asking the same dish still get different
shops + the 🌊 badge). Only the itinerary conversation is canned. Replies take
~1s instead of ~10s.

To switch back to the real agent (needs a valid Gemini key in Hermes):
```bash
MOCK_MODE=0 node webapp/backend/server.js
```

Or run the two parts manually:
```bash
cd webapp/backend  && npm install && node server.js   # :8787
cd webapp/frontend && npm install && npm run dev       # :5173/5174
```

## Try it
- Click **🍜 Quick bite now** → type `beef soup near 中西區 now`
- Click **🗺️ Plan a food itinerary** → answer the questions → get a day plan + map
- Tap the **Next?** chips to continue (another dish, add a bar, full plan…)

## Demo: store distribution across two users
Show that two different users asking for the same dish get routed to **different
shops** (spreading demand across the city — the anti-queue story).

1. **Reset the shared log before the demo:**
   ```bash
   node ~/.hermes/tainan-distlog/distlog.mjs reset
   ```
2. Open **two browser windows** (each window = its own conversation).
3. **Window 1**: `beef soup near 中西區 now` → note the shop (e.g. 豪牛牛肉湯).
4. **Window 2**: same question → you'll get a **different** shop (e.g. 郡西溫體牛肉湯).
5. Inspect the shared log anytime: `node ~/.hermes/tainan-distlog/distlog.mjs get`

How it works: the backend keeps a shared, non-personal log of shops already
recommended and injects an "avoid these" note into the next user's request, so
the agent routes them elsewhere. (The per-customer **dietary profile stays
private** to each conversation — New chat = a fresh customer.) Ask the two
windows **one after the other** (a couple of seconds apart) for the cleanest
effect; simultaneous sends can both read the log before either is recorded.

## Notes
- **Embedded maps** use the Google **Maps Embed API** with the key in
  `frontend/.env` (`VITE_MAPS_KEY`). Enable "Maps Embed API" in Google Cloud for
  the little maps to render; without it, the **📍 Open in Google Maps** link
  still works.
- **Latency**: each reply takes ~6–12s (every message cold-starts a Hermes
  process + the Google Maps MCP). The loading animation covers it.
- **Keys**: the Gemini and Maps keys were shared in plaintext during setup —
  restrict/rotate them in Google Cloud after the demo.
- Config: backend `PORT`/`HERMES_BIN`/`CHAT_TIMEOUT_MS` env vars; frontend
  `VITE_BACKEND`/`VITE_MAPS_KEY` in `frontend/.env`.

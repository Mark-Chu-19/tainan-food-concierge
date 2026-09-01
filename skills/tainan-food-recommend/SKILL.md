---
name: tainan-food-recommend
description: Recommend Tainan shops with fair load-balancing (anti-queue).
---

# Tainan Food Recommend（含店家分流）

Turn a `tainan_food_profile` into a **filtered, fairly-distributed** shortlist of shops across
categories (`food` / `drink` / `alcohol`). The differentiator: **don't send everyone to the #1-rated
shop** — spread demand across all qualifying Tainan shops to reduce queues and support the whole
district. Reference the local seed list `tainan-foods-reference.md` (same folder) for authenticity
and offline fallback.

## Inputs
- `tainan_food_profile` from memory (via `tainan-food-intake`). If missing, ask for **area** + **hard dietary limits** first.
- Google Maps MCP (`google-maps`) — official tool names:
  - `maps_geocode` — area/landmark → lat/long.
  - `maps_search_places` — text search (e.g. "牛肉湯 中西區") → candidate shops with place_id, rating, location.
  - `maps_place_details` — **real data per shop**: `opening_hours` (incl. `open_now`), rating, price_level, address, phone. ← this is what makes "open right now?" accurate.
  - `maps_directions` — route/leg times between stops (for the itinerary).
  When the MCP is available, prefer its real `open_now`/hours over the reference windows.
- Tainan open data dining dataset (optional) for local shops Google misses.
- **Fair-distribution note (auto-injected into the user message).** When other users were recently recommended some shops, the message includes a line like *"prefer DIFFERENT equally-good shops: A, B, C"*. **Honor it**: steer away from those shops toward other qualifying open ones, so demand spreads across the city. (The system records recommendations for you automatically — you don't run any command.)
- Event layer (from `event-boost`): boosted shops + `closed_today` flags.

## Time awareness (for any "now / today" query)
**The current Tainan time is injected at the top of the user message — use it directly; do NOT run `date`** (that wastes a model turn while the user waits). Only if no time was provided, fall back to the terminal tool:
```
TZ='Asia/Taipei' date '+%Y-%m-%d %H:%M %A'
```
Use it as **"now"** (date, clock time, weekday). It drives:
- **open-now filtering** — compare each shop's hours to the current clock time; if the user gave a future visit time/slot, filter to that instead.
- **weekday closures** — many Tainan shops have a fixed rest day (公休日); drop shops closed on today's weekday (from the reference notes or the event layer's `closed_today`).
- **contextual tone** — greet by daypart (breakfast / lunch / late-night) based on the clock.

> Hours source, in priority order: (1) event layer `closed_today` for same-day closures, (2) real hours from Google Maps / Tainan open-data `open_time` when available, (3) the `tainan-foods-reference.md` daypart windows as an approximation. **Be honest when you're only approximating** — say "usually open around lunch" rather than stating exact hours you don't have.

## Procedure
1. **Load profile.** Resolve the target area to coordinates with `maps_geocode`. Establish **"now"** per the Time awareness step above.
2. **Search per needed category.** For each of `food` / `drink` / `alcohol` the profile calls for, query `maps_search_places` in the area (e.g. "牛肉湯", "vegetarian", "craft beer bar"). This returns ~20 results with name, rating, place_id, location.
   > ⚠️ **Token & speed budget — critical.** `maps_place_details` responses are large and every extra turn keeps the user waiting. Rank the search results by rating, shortlist the **top 3**, then request `maps_place_details` for **all 3 in ONE turn (parallel tool calls)** — never serially, hard cap 3–5 per query. Then answer. Supplement with `tainan-foods-reference.md` for anything Maps misses.
3. **Hard filter (must pass all):**
   - dietary: drop shops failing `diet.no` / `vegetarian` / `halal`.
   - time: keep only shops **open at the relevant time** — "now" for an immediate query, or the profile's `time_slots` for a plan. Also drop shops whose fixed rest day falls on today's weekday.
   - budget: match `price_level` to `budget`.
   - `closed_today == TRUE` (from event layer) → drop.
4. **Build a candidate pool per category+dish-type.** Group qualifying shops by dish type (e.g. all beef-soup shops together). Keep the pool broad (aim ≥3 shops per popular type) — this pool is what makes distribution possible.
5. **分流 scoring (pure algorithm).** Score each candidate, applying the fair-distribution note (avoid the shops it lists):

   ```
   score = base_quality
         − frequency_penalty      # de-prioritise recently over-recommended shops
         + event_boost            # from event-boost layer
         + trend_bonus            # from tainan-trending-threads (optional)
         + diversity_jitter       # small tie-breaker to rotate equals

   base_quality      = normalized(rating) ∈ [0,1]
   frequency_penalty = big if the shop is in the avoid-note, else 0    # cross-user rotation
   event_boost       = (boost_weight − 1) × 0.3                    # 1.0 → 0, 2.0 → +0.3
   trend_bonus       = 0.1 if shop/type appears in trending cache else 0
   diversity_jitter  = deterministic small offset by (shop_id + slot index), NOT randomness
   ```
   Pick the **top shop per dish type** by `score` — but because of `frequency_penalty`, repeated
   requests for the same dish rotate through different qualifying shops instead of always the top-rated one.
6. **Guardrail — never collapse to one shop.** If several users/requests want the same dish, ensure the pool rotates: the highest `frequency_penalty` (most-recently-pushed) shops must fall below at least one alternative. If a pool has only one shop, say so honestly rather than faking variety.
7. **(Recording is automatic.)** The system logs which shops you recommended so the next user gets steered elsewhere — you don't need to do anything.
8. **Output a shortlist** (not the final itinerary): for each pick include name (中/EN), district, lat/long, rating, category (food/drink/alcohol), dish type, why-recommended (1 line), and any event note. Then hand off to **`tainan-food-itinerary`**.

## Distribution — worked example
Three tourists ask for 牛肉湯 near 中西區, pool = {阿村(4.5), 六千(4.6), 文章(4.4)}:
- User 1 → 六千 (top). log: 六千=1.
- User 2 → 阿村 (六千 now penalised). log: 阿村=1, 六千=1.
- User 3 → 文章. log balanced.
No single shop gets all the traffic — the point of the skill.

## Notes
- Keep dish names bilingual. Always state opening hours so tourists don't arrive when closed.
- Distribution is **fairness-based, not live-wait-based** (official Places API doesn't expose wait times); frame it that way to users and judges.

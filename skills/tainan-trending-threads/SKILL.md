---
name: tainan-trending-threads
description: Pull trending Tainan food buzz as a recommend signal.
---

# Tainan Trending (Threads)（當紅美食趨勢訊號）

Produce a lightweight **"what's hot in Tainan right now"** signal that `tainan-food-recommend`
folds in as a small `trend_bonus`. This is a **signal, not a dependency** — the pipeline must work
even when no live data is available.

## Sources (in priority order)
1. **Threads Keyword Search API** (`threads_keyword_search`) — best when approved. Note: requires
   Meta app review; without it, search only returns the authed account's own posts. Rate limit ~500
   queries / rolling 7 days. Query terms like `台南 美食`, `台南 牛肉湯`, `台南 咖啡`, `台南 酒吧`.
2. **Web search** — general search over public Threads / social posts for recent Tainan food buzz.
3. **Cache fallback** — read `data/threads-trending.cache.md` (manually refreshed before a demo).

## Procedure
1. Try source 1; if the permission/tool is unavailable, fall back to 2, then 3. **Never fail** — always return something (even if just the cache).
2. Extract trending **dish types / shops / areas** with a rough heat level (high/mid).
3. Write to memory key `tainan_trending`:
   ```
   tainan_trending:
     updated: <date>
     source: <threads-api|web|cache>
     items: [ { type|shop, area, heat, note } ... ]
   ```
4. Optionally refresh `data/threads-trending.cache.md` when you got fresh API/web data, so future offline runs are current.
5. `tainan-food-recommend` reads `tainan_trending` and adds `trend_bonus` to matching candidates — nudging, not dominating, the ranking.

## Notes
- Be honest about the source in output ("trending per cached buzz, last updated …") — don't present cache as live.
- Trend must never override dietary filters or the fairness distribution; it's a small tie-breaker bonus only.
- Respect Threads API rate limits; batch queries and reuse the cache between demos.

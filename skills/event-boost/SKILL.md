---
name: event-boost
description: Read gov/shop event sheet; boost matching shops & flag closures.
---

# Event Boost（政府 / 店家活動強推層）

Let a **city government or shop owner** influence recommendations by editing a plain
**Google Sheet** — no code. This skill reads that sheet and produces an **event layer** that
`tainan-food-recommend` consumes: shops tied to a live local event get a boost, and shops marked
closed today are excluded from distribution.

## Data source
A Google Sheet (or the published CSV `data/events.sheet-template.csv`) with columns:

| column | meaning |
|--------|---------|
| `shop_name` | shop to affect (match to recommendations) |
| `district` | area, for matching |
| `category` | food / drink / alcohol |
| `event_title`, `event_desc` | the promotion/event to echo in the pitch |
| `start_date`, `end_date` | active window |
| `boost_weight` | 1.0 = none, >1 = stronger push (feeds `event_boost` in recommend) |
| `closed_today` | TRUE → exclude from distribution |
| `note` | free text |

Read it via the `google-sheets` MCP server, or fetch the sheet's published CSV URL. Fall back to the
local `data/events.sheet-template.csv` for offline/demo.

## Procedure
1. **Load rows** from the sheet/CSV.
2. **Filter to active events** — keep rows where today (ask the user's trip date / system date) is within `[start_date, end_date]`, plus any row with `closed_today = TRUE`.
3. **Emit the event layer** to memory key `tainan_event_layer`:
   ```
   tainan_event_layer:
     boosts: { <shop_name>: { boost_weight, event_title, event_desc, category, district } }
     closed_today: [ <shop_name>... ]
   ```
4. **Hand back to `tainan-food-recommend`**, which uses `boost_weight` in its 分流 score and drops `closed_today` shops.
5. When a boosted shop makes the final list, **surface the event** in the pitch, e.g. *"莉莉水果店 — mango-ice buy-one-get-one during the Summer Mango Festival (till Aug 15)"*, so recommendations actively echo the city's programming.

## Notes
- This layer is authoritative for **events and closures only** — it does not override hard dietary filters.
- Because closures and boosts flow through the same sheet, non-technical staff manage everything in one place; refresh on each new conversation.
- Keep the boost bounded (cap `boost_weight` effect in recommend) so an event can't fully defeat the fairness distribution.

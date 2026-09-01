---
name: tainan-food-itinerary
description: Build a timed Tainan food route with a Google Maps link.
---

# Tainan Food Itinerary（美食地圖行程）

Turn the shortlist from `tainan-food-recommend` into a **time-ordered day plan** that always covers
**food + drink + alcohol** (alcohol only if the profile says the user drinks), ordered by geography,
and output a **Google Maps route link** the user can open on their phone.

## Inputs
- Shortlist from `tainan-food-recommend` (each item has name, lat/long, category, dish type, hours, why).
- `tainan_food_profile` (time_slots, meals_wanted, alcohol.drinks, dates).
- Google Maps MCP (`google-maps`): `maps_geocode`, `maps_directions`, distance/time between stops.

## Procedure
0. **Anchor to real time.** Get the current Tainan date/weekday with `TZ='Asia/Taipei' date '+%Y-%m-%d %H:%M %A'`. If the plan is for **today**, don't schedule stops in the past — start from the next sensible daypart after "now". Respect **weekday closures** for the plan's date (drop shops closed that day). Map the profile's `dates` to actual weekdays so closures are checked against the right day.
1. **Slot the stops** onto the day using the time model (from `tainan-foods-reference.md`):
   breakfast → lunch → afternoon drink/dessert → dinner → (night bar). Respect the profile's
   `time_slots` and `meals_wanted`; drop the bar if `alcohol.drinks = false`.
2. **Guarantee coverage**: ensure at least one `food`, one `drink`, and (if drinking) one `alcohol`
   stop. If a category is missing, ask `tainan-food-recommend` for one more pick.
3. **Order by geography**: use `maps_directions` / distance to sequence stops to minimise back-tracking;
   compute walking (or transit) time between consecutive stops.
4. **Sanity-check hours**: each stop must be open in its assigned slot; if not, reorder or swap.
5. **Build the map link** — a Google Maps directions deep-link chaining all stops in order:
   ```
   https://www.google.com/maps/dir/?api=1
     &origin=<lat,lng of stop 1 or user's stay>
     &destination=<lat,lng of last stop>
     &waypoints=<lat,lng>|<lat,lng>|...   (middle stops, in order)
     &travelmode=walking
   ```
   URL-encode the `waypoints` pipe list. Prefer place coordinates; fall back to `名稱, Tainan`.
6. **Output** in English (bilingual dish names), as:
   - A **schedule table**: time slot · shop (中/EN) · category · 1-line why · open hours · event note (if boosted).
   - **Total walking time** and rough route summary.
   - The **Google Maps route link** (the hero deliverable).
   - Note which picks came from the fairness distribution ("we routed you to 阿村牛肉湯 to spread demand — 六千 is great too but busier with tourists").
7. **(Optional, if time) HTML map card**: a self-contained shareable HTML with the stops list and the same map link.

## Example output shape
```
🍜 Your Tainan Food Day — West Central (vegetarian, craft-beer finish)

08:00  阿村牛肉湯? → 阿霞素食粥 (breakfast, food, veg) · open 06–11
11:30  蔬食自助 XX (lunch, food, veg) · open 11–14
15:00  莉莉水果店 (afternoon, drink) · mango-ice B1G1 — Summer Mango Festival 🎉
18:30  神農街素食餐酒館 (dinner, food, veg) · open 17–21
21:00  神農街精釀 (night, alcohol) · craft beer · open 18–24

🚶 ~35 min walking total
🗺️ Open route: https://www.google.com/maps/dir/?api=1&...
```

## Notes
- Always keep the Google Maps link valid and test-openable — it's the demo hero.
- If a stop was chosen by distribution over the top-rated option, say so in one friendly line; it's the product's whole point.

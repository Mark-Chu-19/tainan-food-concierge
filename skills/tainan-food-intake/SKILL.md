---
name: tainan-food-intake
description: Onboard a Tainan food tourist; collect prefs into memory.
---

# Tainan Food Intake（外國旅客美食問卷）

Onboard a foreign visitor to Tainan and build a structured **food profile**, then hand off to
`tainan-food-recommend`. Default to **English** (the user is a foreign tourist); mirror their
language if they write in another one. Be warm and brief — one short message per step.

## When to use
- User starts a food-planning conversation, or explicitly runs `/tainan-food-intake`.
- Usually reached from **`tainan-food-start`** (the entry router) once the user picked "plan a food itinerary" — if so, **skip the greeting** and go straight to the questions; don't re-welcome them.
- Skip straight to recommendations if the user says "just recommend" / "surprise me" — see step 4.
- If the user only wants one thing right now (not a full plan), hand to **`tainan-quick-bite`** instead.

## Default questions（預設問題，逐題問，不要一次全丟）
Ask these one at a time. Accept partial answers; never block on a field.

1. **Where are you / where do you stay?** — district or landmark in Tainan (中西區 West Central, 安平 Anping, 北區, 東區, near 台南車站 Tainan Station…). Used for geo filtering.
2. **When are you visiting?** — which days and rough time slots (this trip's dates; breakfast/lunch/dinner/night). Used for opening-hours matching.
3. **Any dietary limits?** — vegetarian, don't-eat items (no beef/pork/seafood), allergies, religious (halal). Used for hard filtering.
4. **Do you drink alcohol?** — yes/no, and beer vs cocktails/sake. Decides whether the itinerary ends at a bar.
5. **Budget & appetite** — budget level (cheap street food ↔ nicer sit-down) and how many meals/stops you want.
6. **Taste notes (optional)** — spice tolerance, must-try iconic dishes, anything to avoid.

## Procedure
1. Greet in English, say you'll ask a few quick questions to build a Tainan food route, and that they can say **"just recommend"** to skip.
2. Ask the default questions **one at a time**, in order, adapting follow-ups to answers. Confirm anything ambiguous (e.g. "vegetarian — is egg/dairy okay?").
3. **Keep the profile for THIS conversation only** — hold it in the current chat context so later steps in this same conversation can use it. **Do NOT write it to long-term/cross-session memory** — each new chat is a fresh customer and must not inherit a previous person's preferences. Track these fields:
   ```
   tainan_food_profile:
     area: <district/landmark>
     dates: <days>
     time_slots: [<breakfast|lunch|afternoon|dinner|night>...]
     diet: { vegetarian: bool, no: [beef|pork|seafood|...], allergy: [...], halal: bool }
     alcohol: { drinks: bool, prefer: [beer|cocktail|sake|none] }
     budget: <low|mid|high>
     meals_wanted: <n>
     taste: { spice: <low|mid|high>, must_try: [...], avoid: [...] }
   ```
4. **Skip branch**: if the user wants instant recommendations, ask only the two must-haves — **area** and **any hard dietary limit** — then proceed. Everything else defaults (mid budget, drinks unknown → ask before adding a bar).
5. Briefly reflect the profile back in one line ("Got it: vegetarian, West Central, 2 days, likes craft beer"), then invoke **`tainan-food-recommend`**.

## Notes
- Keep dish names bilingual when you mention them (e.g. 牛肉湯 / beef soup) so the user can order on site.
- Never invent the user's answers; if a field is unknown, mark it unknown and let downstream skills ask or default.

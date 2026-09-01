// Parse an assistant reply into: intro/body text, "Next?" suggestion chips,
// and STRUCTURED shop blocks (rendered as pretty cards, not raw text).
// Expected shop block shape from the agent:
//   1. 冰鄉 (Bing Xiang) ⭐4.2 中西區
//      Famous seasonal mango milk ice with fresh fruit
//      Open until 8 PM today
//      https://www.google.com/maps/...
// Blocks end at a blank line, the next ⭐ headline, or the Next? line.
// Anything that doesn't parse stays in the body text (safe fallback).

const URL_RE_G = /https?:\/\/[^\s)]+/;
const URL_ONLY_RE = /^\s*(?:🗺️|📍)?\s*https?:\/\/\S+\s*$/;
const HOURS_RE = /^(open|closed|opens|closes|營業|公休|休息)/i;

export function parseReply(text) {
  const rawLines = text.split("\n");
  const bodyLines = [];
  let chips = [];
  const shops = [];
  let cur = null;

  const flush = () => {
    if (cur) {
      shops.push(cur);
      cur = null;
    }
  };

  for (const raw of rawLines) {
    const line = raw.trim();

    if (!line) {
      flush();
      bodyLines.push("");
      continue;
    }

    // "Next?" suggestion line -> chips (never shown as text)
    if (/^next[?:]/i.test(line)) {
      flush();
      chips = line
        .replace(/^next[?:]\s*/i, "")
        .split(/[·|]/)
        .map((s) => s.trim())
        .filter(Boolean);
      continue;
    }

    // Shop headline: contains ⭐
    if (line.includes("⭐")) {
      flush();
      const cleaned = line.replace(/^\s*\d+[.)]\s*/, "").replace(/\*\*/g, "");
      const starIdx = cleaned.indexOf("⭐");
      const name = cleaned.slice(0, starIdx).trim();
      const after = cleaned.slice(starIdx + 1).trim(); // "4.2 中西區"
      const m = after.match(/^([\d.]+)\s*(.*)$/);
      cur = {
        name,
        rating: m ? m[1] : "",
        area: m ? m[2].trim() : after,
        desc: [],
        hours: "",
        url: "",
        query: name.replace(/\s*[（(].*?[)）]\s*/g, "").trim() + ", Tainan",
      };
      continue;
    }

    // Inside a shop block: absorb its lines
    if (cur) {
      const urlMatch = line.match(URL_RE_G);
      if (URL_ONLY_RE.test(line)) {
        cur.url = urlMatch ? urlMatch[0] : "";
        continue;
      }
      if (HOURS_RE.test(line)) {
        cur.hours = line;
        continue;
      }
      cur.desc.push(line);
      continue;
    }

    // Plain body text; hide stray URL-only lines
    if (URL_ONLY_RE.test(line)) continue;
    bodyLines.push(line);
  }
  flush();

  const body = bodyLines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { body, chips, shops };
}

const URL_RE = /(https?:\/\/[^\s)]+)/g;

// Split a string into text/link segments for rendering.
export function linkify(text) {
  const parts = [];
  let last = 0;
  let m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text)) !== null) {
    if (m.index > last) parts.push({ t: "text", v: text.slice(last, m.index) });
    parts.push({ t: "link", v: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ t: "text", v: text.slice(last) });
  return parts;
}

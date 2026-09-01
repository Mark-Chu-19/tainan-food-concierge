// Shared cross-user "fair distribution" log — the anti-queue engine's memory.
// File format: { "<shop>": [epochMs, ...] } — one timestamp per recommendation.
// Only entries inside DIST_WINDOW_MS (default 2h) count; older ones expire, so
// "recently recommended" stays true to its name and the log never grows
// unbounded. Holds only shop names + timestamps (no personal data), so sharing
// it across sessions is intentional — unlike the per-chat dietary profile.

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const DIST_LOG =
  process.env.DIST_LOG_PATH || path.join(REPO_ROOT, ".data", "distlog.json");
const DIST_WINDOW_MS = Number(process.env.DIST_WINDOW_MS || 2 * 60 * 60 * 1000);
const MAX_AVOID = 8; // cap how many shops we steer the agent away from

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(DIST_LOG, "utf8"));
  } catch {
    return {};
  }
}

function pruneStore(store) {
  const now = Date.now();
  const out = {};
  for (const [name, v] of Object.entries(store)) {
    // Legacy plain-number entries carry no timestamps → treat as expired.
    const arr = Array.isArray(v) ? v.filter((t) => now - t < DIST_WINDOW_MS) : [];
    if (arr.length) out[name] = arr;
  }
  return out;
}

function writeStore(store) {
  try {
    fs.mkdirSync(path.dirname(DIST_LOG), { recursive: true });
    fs.writeFileSync(DIST_LOG, JSON.stringify(store, null, 2));
  } catch (e) {
    console.error("distlog write failed:", e.message);
  }
}

// Windowed counts: { shop: recommendations within the window }
function readLog() {
  const store = pruneStore(readStore());
  const counts = {};
  for (const [name, arr] of Object.entries(store)) counts[name] = arr.length;
  return counts;
}

function bumpShops(names) {
  if (!names.length) return;
  const store = pruneStore(readStore());
  const now = Date.now();
  for (const n of names) (store[n] = store[n] || []).push(now);
  writeStore(store);
}

// Most-recommended shops first, capped — the ones worth steering away from.
function avoidList() {
  return Object.entries(readLog())
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_AVOID)
    .map(([name]) => name);
}

module.exports = { readLog, bumpShops, avoidList, DIST_LOG };

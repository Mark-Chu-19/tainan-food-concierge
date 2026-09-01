#!/usr/bin/env node
// Shared cross-user "fair distribution" log for the Tainan food agent.
// Rolling time window: only recommendations within DIST_WINDOW_MS (default 2h)
// count; older entries expire automatically, so the log never grows unbounded
// and "recently recommended" stays accurate.
//
// File format: { "<shop>": [epochMs, ...] }  (one timestamp per recommendation)
// This holds only shop names + times (not personal data), so it is shared
// across sessions on purpose, unlike the per-chat dietary profile.
//
// Usage:
//   node distlog.mjs get            -> { "<shop>": countWithinWindow, ... }
//   node distlog.mjs bump "<shop>"  -> record one recommendation now (atomic)
//   node distlog.mjs reset          -> clear everything (run before a demo)

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  openSync,
  closeSync,
  unlinkSync,
} from "fs";
import { homedir } from "os";
import { join } from "path";

const DIR = join(homedir(), ".hermes", "tainan-distlog");
const LOG = join(DIR, "log.json");
const LOCK = join(DIR, "log.lock");
const WINDOW_MS = Number(process.env.DIST_WINDOW_MS || 2 * 60 * 60 * 1000);

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function readStore() {
  try {
    return JSON.parse(readFileSync(LOG, "utf8"));
  } catch {
    return {};
  }
}
function prune(store) {
  const now = Date.now();
  const out = {};
  for (const [name, v] of Object.entries(store)) {
    // Legacy plain-number entries carry no timestamps -> treat as expired.
    const arr = Array.isArray(v) ? v.filter((t) => now - t < WINDOW_MS) : [];
    if (arr.length) out[name] = arr;
  }
  return out;
}
function write(store) {
  writeFileSync(LOG, JSON.stringify(store, null, 2));
}
// Simple cross-process lock so concurrent writers don't clobber each other.
function lock() {
  for (let i = 0; i < 100; i++) {
    try {
      closeSync(openSync(LOCK, "wx"));
      return true;
    } catch {
      sleep(15);
    }
  }
  return false;
}
function unlock() {
  try {
    unlinkSync(LOCK);
  } catch {}
}

mkdirSync(DIR, { recursive: true });
const [cmd, ...rest] = process.argv.slice(2);

if (cmd === "get") {
  const store = prune(readStore());
  const counts = {};
  for (const [name, arr] of Object.entries(store)) counts[name] = arr.length;
  process.stdout.write(JSON.stringify(counts));
} else if (cmd === "bump") {
  const name = rest.join(" ").trim();
  if (!name) {
    console.error('bump needs a shop name: distlog.mjs bump "<shop>"');
    process.exit(1);
  }
  const locked = lock();
  try {
    const store = prune(readStore());
    (store[name] = store[name] || []).push(Date.now());
    write(store);
    process.stdout.write("ok");
  } finally {
    if (locked) unlock();
  }
} else if (cmd === "reset") {
  const locked = lock();
  try {
    write({});
    process.stdout.write("reset");
  } finally {
    if (locked) unlock();
  }
} else {
  console.error('usage: distlog.mjs get | bump "<shop>" | reset');
  process.exit(1);
}

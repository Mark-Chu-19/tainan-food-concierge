import React, { useState, useRef, useEffect } from "react";
import { sendChat, newSession, getPromotions, getCityStats } from "./api.js";
import { parseReply, linkify } from "./reply.js";

const MAPS_KEY = import.meta.env.VITE_MAPS_KEY || "";
// Embedded mini-maps need the "Maps Embed API" enabled on the key's project.
// Off by default so an un-enabled project never shows an ugly error iframe.
const MAPS_EMBED = import.meta.env.VITE_MAPS_EMBED === "true";

// ── Shop card (structured, pretty rendering of a recommendation) ──────
function ShopCard({ shop }) {
  const openUrl =
    shop.url ||
    "https://www.google.com/maps/search/?api=1&query=" +
      encodeURIComponent(shop.query);
  const embedUrl =
    MAPS_EMBED && MAPS_KEY
      ? "https://www.google.com/maps/embed/v1/search?key=" +
        MAPS_KEY +
        "&q=" +
        encodeURIComponent(shop.query)
      : null;
  return (
    <div className="shopcard">
      {embedUrl && (
        <iframe
          title={shop.name}
          className="mapframe"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          src={embedUrl}
        />
      )}
      <div className="shopcard-body">
        <div className="shopcard-head">
          <span className="shopname">{shop.name}</span>
          {shop.rating && <span className="pill rating">⭐ {shop.rating}</span>}
          {shop.area && <span className="pill area">📍 {shop.area}</span>}
        </div>
        {shop.desc.length > 0 && (
          <div className="shopdesc">{shop.desc.join(" ")}</div>
        )}
        {shop.hours && <div className="shophours">🕐 {shop.hours}</div>}
        <a className="maplink" href={openUrl} target="_blank" rel="noreferrer">
          Open in Google Maps →
        </a>
      </div>
    </div>
  );
}

// ── Linkified text (renders URLs as links) ────────────────────────────
function RichText({ text }) {
  return (
    <>
      {text.split("\n").map((line, i) => (
        <div key={i} className="rt-line">
          {linkify(line).map((p, j) =>
            p.t === "link" ? (
              <a key={j} href={p.v} target="_blank" rel="noreferrer">
                {p.v.length > 40 ? "link ↗" : p.v}
              </a>
            ) : (
              <span key={j}>{p.v}</span>
            )
          )}
        </div>
      ))}
    </>
  );
}

// ── Chat bubble ───────────────────────────────────────────────────────
function Bubble({ msg, onChip }) {
  if (msg.role === "user") {
    return (
      <div className="row right appear">
        <div className="bubble user">{msg.text}</div>
      </div>
    );
  }
  const { body, chips, shops } = parseReply(msg.text);
  // de-dupe shops by query
  const seen = new Set();
  const uniqueShops = shops.filter((s) =>
    seen.has(s.query) ? false : (seen.add(s.query), true)
  );
  return (
    <div className="row left appear">
      <div className="avatar">🍜</div>
      <div className="bubble bot">
        {msg.balanced && (
          <div className="balanced-badge">
            🌊 Balanced — routed away from shops other visitors were just sent to
          </div>
        )}
        {body && <RichText text={body} />}
        {uniqueShops.length > 0 && (
          <div className="cards">
            {uniqueShops.map((s, i) => (
              <ShopCard key={i} shop={s} />
            ))}
          </div>
        )}
        {chips.length > 0 && (
          <div className="chips">
            {chips.map((c, i) => (
              <button
                key={i}
                className="chip"
                onClick={() =>
                  // "different spots" on a campaign reply re-triggers the
                  // promo fast path (rotation serves 3 new shops). All other
                  // chips go through the normal flow.
                  msg.promoEvent && /different spots/i.test(c)
                    ? onChip("Show me different spots", msg.promoEvent)
                    : onChip(c)
                }
              >
                {c}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── City dashboard (the government's live view — the public-value story) ──
function CityDashboard({ promo, onClose }) {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => getCityStats().then((s) => alive && setStats(s));
    load();
    const t = setInterval(load, 4000); // live-updates while judges watch
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const entries = Object.entries(stats || {}).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, c]) => s + c, 0);
  const max = entries.length ? entries[0][1] : 1;
  const topShare = total ? Math.round((max / total) * 100) : 0;

  return (
    <div className="dash appear">
      <div className="dash-head">
        <div>
          <div className="dash-title">🏙️ City View — Tainan Tourism Bureau</div>
          <div className="dash-sub">
            Live demand distribution across the city, updated in real time
          </div>
        </div>
        <button className="reset" onClick={onClose}>
          ← Back to chat
        </button>
      </div>

      <div className="dash-stats">
        <div className="stat">
          <div className="stat-n">{total}</div>
          <div className="stat-l">recommendations served</div>
        </div>
        <div className="stat">
          <div className="stat-n">{entries.length}</div>
          <div className="stat-l">shops sharing the demand</div>
        </div>
        <div className="stat">
          <div className="stat-n">{entries.length ? `${topShare}%` : "—"}</div>
          <div className="stat-l">largest single-shop share</div>
        </div>
      </div>

      <div className="dash-section">Demand spread (live)</div>
      {entries.length === 0 ? (
        <div className="dash-empty">
          No recommendations yet — ask the concierge for food and watch this
          fill up.
        </div>
      ) : (
        <div className="dash-bars">
          {entries.map(([name, count]) => (
            <div key={name} className="bar-row">
              <span className="bar-name">{name}</span>
              <div className="bar-track">
                <div
                  className="bar-fill"
                  style={{ width: `${(count / max) * 100}%` }}
                />
              </div>
              <span className="bar-count">{count}</span>
            </div>
          ))}
        </div>
      )}

      {promo && (
        <>
          <div className="dash-section">Active city campaign</div>
          <div className="dash-campaign">
            <span className="dash-emoji">{promo.emoji}</span>
            <div>
              <b>{promo.label}</b> — {promo.shops.length}+ partner shops are
              being promoted to visitors this month, maintained by the city and
              merchants in a shared sheet.
            </div>
          </div>
        </>
      )}

      <div className="dash-foot">
        Without fair distribution, every visitor gets sent to the same
        top-rated shop. This engine spreads them across equally good spots —
        shorter queues for tourists, more business for the whole street.
      </div>
    </div>
  );
}

// ── Rotating loading status (makes the wait feel active) ──────────────
const LOADING_STEPS = [
  "Checking what's open right now…",
  "Looking at ratings nearby…",
  "Picking quieter spots so you skip the queues…",
  "Almost there, writing it up…",
];
function LoadingStatus() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(
      () => setStep((s) => Math.min(s + 1, LOADING_STEPS.length - 1)),
      2600
    );
    return () => clearInterval(t);
  }, []);
  return (
    <div className="row left appear">
      <div className="avatar">🍜</div>
      <div className="bubble bot loadingb">
        <span className="dot" />
        <span className="dot" />
        <span className="dot" />
        <span className="loadingtxt" key={step}>
          {LOADING_STEPS[step]}
        </span>
      </div>
    </div>
  );
}

// ── Proactive seasonal promotion banner ───────────────────────────────
function PromoBanner({ promo, onPick, onDismiss }) {
  return (
    <div className="promo">
      <button className="promo-x" onClick={onDismiss} aria-label="dismiss">
        ✕
      </button>
      <div className="promo-emoji">{promo.emoji}</div>
      <div className="promo-body">
        <div className="promo-head">
          It's {promo.label} in Tainan right now!
        </div>
        <div className="promo-blurb">{promo.blurb}</div>
        <div className="promo-shops">
          {promo.shops.slice(0, 4).map((s, i) => (
            <span key={i} className="promo-shop">
              {s.name}
              <small> · {s.area}</small>
            </span>
          ))}
        </div>
        <button
          className="promo-cta"
          onClick={() => onPick(promo.query, promo.event)}
        >
          Show me {promo.emoji} →
        </button>
      </div>
    </div>
  );
}

// ── Start screen (two mode buttons) ───────────────────────────────────
function StartScreen({ onPick, promo, onDismiss }) {
  return (
    <div className="start">
      {promo && (
        <PromoBanner promo={promo} onPick={onPick} onDismiss={onDismiss} />
      )}
      <div className="hero-emoji">🍜</div>
      <h1>Tainan Nomnom</h1>
      <p className="tagline">
        Your local food guide for Tainan. Real-time hours, ratings &amp; a map —
        picked to spread the love across the city, not just the #1 shop.
      </p>
      <div className="modebtns">
        <button
          className="modebtn plan"
          onClick={() =>
            onPick("Let's plan a full food itinerary for my trip in Tainan.")
          }
        >
          🗺️
          <span>Plan a food itinerary</span>
          <small>A full day/trip route with a map</small>
        </button>
        <button
          className="modebtn quick"
          onClick={() => onPick("I want a quick bite right now.")}
        >
          🍜
          <span>Quick bite now</span>
          <small>Tell me your craving &amp; where you are</small>
        </button>
      </div>
      <p className="hint">…or just type what you're craving below.</p>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────
export default function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [promo, setPromo] = useState(null);
  const [bannerOff, setBannerOff] = useState(false);
  const [cityView, setCityView] = useState(false);
  const lastMsg = useRef("");
  const scroller = useRef(null);

  useEffect(() => {
    scroller.current?.scrollTo({
      top: scroller.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, loading]);

  // Fetch this month's active promotion once on load.
  useEffect(() => {
    getPromotions().then((ps) => setPromo(ps[0] || null));
  }, []);

  async function send(text, promo) {
    const message = (text || "").trim();
    if (!message || loading) return;
    lastMsg.current = message;
    setError("");
    setInput("");
    setCityView(false);
    setMessages((m) => [...m, { role: "user", text: message }]);
    setLoading(true);
    try {
      const { reply, balanced } = await sendChat(message, promo);
      setMessages((m) => [
        ...m,
        { role: "bot", text: reply, balanced, promoEvent: promo || null },
      ]);
    } catch (e) {
      setError(e.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  // Retry the last user message (drop the failed user bubble first).
  function retry() {
    if (!lastMsg.current || loading) return;
    setMessages((m) =>
      m.length && m[m.length - 1].role === "user" ? m.slice(0, -1) : m
    );
    send(lastMsg.current);
  }

  function reset() {
    newSession();
    setMessages([]);
    setError("");
    setInput("");
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brandwrap">
          <span className="brandmark">🍜</span>
          <div>
            <div className="brand">Tainan Nomnom</div>
            <div className="brandsub">
              <span className="livedot" /> Live hours · fair to every shop
            </div>
          </div>
        </div>
        <div className="hdr-actions">
          <button
            className={"reset city" + (cityView ? " on" : "")}
            onClick={() => setCityView((v) => !v)}
          >
            🏙️ City view
          </button>
          {messages.length > 0 && (
            <button className="reset" onClick={reset}>
              ⟳ New chat
            </button>
          )}
        </div>
      </header>

      <main className="scroll" ref={scroller}>
        {cityView ? (
          <CityDashboard promo={promo} onClose={() => setCityView(false)} />
        ) : messages.length === 0 && !loading ? (
          <StartScreen
            onPick={send}
            promo={bannerOff ? null : promo}
            onDismiss={() => setBannerOff(true)}
          />
        ) : (
          <div className="thread">
            {messages.map((m, i) => (
              <Bubble key={i} msg={m} onChip={send} />
            ))}
            {loading && <LoadingStatus />}
          </div>
        )}
      </main>

      {error && (
        <div className="errbar">
          ⚠️ {error}
          <button className="retrybtn" onClick={retry}>
            ↻ Try again
          </button>
        </div>
      )}

      <footer className="composer">
        <input
          value={input}
          placeholder="Type a craving, or tell me where you are (hotel, landmark...)"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send(input)}
          disabled={loading}
        />
        <button
          className="sendbtn"
          onClick={() => send(input)}
          disabled={loading || !input.trim()}
          aria-label="Send"
        >
          ➤
        </button>
      </footer>
    </div>
  );
}

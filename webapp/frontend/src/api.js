const BACKEND = import.meta.env.VITE_BACKEND || "http://localhost:8787";

// Stable per-tab browser session id (keeps agent context across messages).
export function getSessionId() {
  let id = sessionStorage.getItem("tfc_session");
  if (!id) {
    id = "web-" + Math.random().toString(36).slice(2) + "-" + Date.now();
    sessionStorage.setItem("tfc_session", id);
  }
  return id;
}

export function newSession() {
  sessionStorage.removeItem("tfc_session");
  return getSessionId();
}

export async function getPromotions() {
  try {
    const res = await fetch(`${BACKEND}/promotions`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.promotions || [];
  } catch {
    return [];
  }
}

export async function sendChat(message, promo) {
  const res = await fetch(`${BACKEND}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: getSessionId(),
      message,
      ...(promo ? { promo } : {}),
    }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `Backend error ${res.status}`);
  }
  const data = await res.json();
  return { reply: data.reply, balanced: !!data.balanced };
}

export async function getCityStats() {
  try {
    const res = await fetch(`${BACKEND}/health`);
    if (!res.ok) return null;
    const d = await res.json();
    return d.distribution || {};
  } catch {
    return null;
  }
}

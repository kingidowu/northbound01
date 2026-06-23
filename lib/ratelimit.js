// Per-IP rate limiter for the AI endpoints (protects your Anthropic bill).
//
// Strong mode: if UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set,
// limits are enforced GLOBALLY across all serverless instances via Upstash Redis
// (free tier is plenty). The token is the "API key".
// Fallback mode: with no Upstash config, a per-instance in-memory limiter still
// blocks casual scripted abuse. Either way, each function also hard-caps input
// size and max_tokens.
const buckets = new Map(); // ip -> { count, reset }

function inMemory(ip, limit, windowMs) {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b || now > b.reset) { b = { count: 0, reset: now + windowMs }; buckets.set(ip, b); }
  b.count++;
  if (buckets.size > 5000) { for (const [k, v] of buckets) if (now > v.reset) buckets.delete(k); }
  return { ok: b.count <= limit, retryAfter: Math.max(1, Math.ceil((b.reset - now) / 1000)) };
}

export async function rateLimit(req, { limit = 15, windowMs = 60_000 } = {}) {
  const ip =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "unknown";

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    try {
      const windowSec = Math.ceil(windowMs / 1000);
      const key = `rl:${ip}:${Math.floor(Date.now() / windowMs)}`;
      const r = await fetch(`${url}/incr/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const { result } = await r.json();
      if (result === 1) {
        await fetch(`${url}/expire/${encodeURIComponent(key)}/${windowSec}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      }
      return { ok: result <= limit, retryAfter: windowSec };
    } catch {
      // Upstash unreachable — fall back to in-memory rather than fail open hard.
    }
  }
  return inMemory(ip, limit, windowMs);
}

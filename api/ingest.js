import { getServiceClient, ingest } from "../lib/knowledge.js";
import { rateLimit } from "../lib/ratelimit.js";

// Admin-only: paste a resume straight into the knowledge library to strengthen
// the AI. Verifies the caller's Supabase session belongs to an admin, then
// extracts + stores structured knowledge (cheap Haiku extraction, no full ATS run).
export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  const rl = await rateLimit(req, { limit: 40, windowMs: 60_000 });
  if (!rl.ok) { res.setHeader("Retry-After", rl.retryAfter); res.status(429).json({ error: "Too many requests." }); return; }

  try {
    const b = req.body && typeof req.body === "object" ? req.body : {};
    const access_token = b.access_token;
    const text = (b.resume || "").toString().slice(0, 16000).trim();
    if (!access_token) { res.status(401).json({ error: "Sign in as admin." }); return; }
    if (text.length < 80) { res.status(400).json({ error: "Paste a full resume (a few lines)." }); return; }

    const sb = getServiceClient();
    if (!sb) { res.status(500).json({ error: "Not configured" }); return; }

    // Verify the session token and that the user is an admin.
    const { data: u, error: ue } = await sb.auth.getUser(access_token);
    if (ue || !u?.user) { res.status(401).json({ error: "Invalid session." }); return; }
    const { data: adminRow } = await sb.from("admins").select("id").eq("id", u.user.id).maybeSingle();
    if (!adminRow) { res.status(403).json({ error: "Admins only." }); return; }

    const extraction = await ingest(sb, "resume", b.label || "Admin-added resume", text);
    if (!extraction) { res.status(502).json({ error: "Extraction failed." }); return; }
    res.status(200).json({ ok: true, field: extraction.field, seniority: extraction.seniority, summary: extraction.summary });
  } catch (e) {
    console.error("ingest failed:", e);
    res.status(502).json({ error: "Could not add to library." });
  }
}

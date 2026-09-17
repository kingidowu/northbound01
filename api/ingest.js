import { getServiceClient, ingest } from "../lib/knowledge.js";
import { analyzeResume } from "../lib/ats-analysis.js";
import { rateLimit } from "../lib/ratelimit.js";

// Admin-only: paste a resume straight into the knowledge library to strengthen
// the AI. Verifies the caller's Supabase session belongs to an admin, then
// scans ATS readiness, extracts career knowledge, and stores both results.
export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  const rl = await rateLimit(req, { limit: 40, windowMs: 60_000 });
  if (!rl.ok) { res.setHeader("Retry-After", rl.retryAfter); res.status(429).json({ error: "Too many requests." }); return; }

  try {
    const b = req.body && typeof req.body === "object" ? req.body : {};
    const access_token = b.access_token;
    if (!access_token) { res.status(401).json({ error: "Sign in as admin." }); return; }

    const text = (b.resume || "").toString().slice(0, 16000).trim();
    const fileB64 = (b.file_base64 || "").toString();
    const mediaType = (b.media_type || "").toString();
    const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

    // Build the model input: text, PDF document, or image.
    let input, label = b.label || "Admin-added resume";
    if (fileB64 && mediaType === "application/pdf") {
      input = [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: fileB64 } },
        { type: "text", text: "This is a candidate resume. Extract structured career knowledge per the schema." },
      ];
    } else if (fileB64 && IMAGE_TYPES.includes(mediaType)) {
      input = [
        { type: "image", source: { type: "base64", media_type: mediaType, data: fileB64 } },
        { type: "text", text: "This is a candidate resume (image). Read it and extract structured career knowledge per the schema." },
      ];
    } else if (text.length >= 80) {
      input = text;
    } else {
      res.status(400).json({ error: "Paste a resume, or upload a PDF, Word, or image file." }); return;
    }
    if (fileB64.length > 11_000_000) { res.status(413).json({ error: "File too large (max ~8MB)." }); return; }

    const sb = getServiceClient();
    if (!sb) { res.status(500).json({ error: "Not configured" }); return; }

    // Verify the session token and that the user is an admin.
    const { data: u, error: ue } = await sb.auth.getUser(access_token);
    if (ue || !u?.user) { res.status(401).json({ error: "Invalid session." }); return; }
    const { data: adminRow } = await sb.from("admins").select("id").eq("id", u.user.id).maybeSingle();
    if (!adminRow) { res.status(403).json({ error: "Admins only." }); return; }

    const analysis = await analyzeResume(input);
    analysis.score_basis = "General ATS readiness";
    const extraction = await ingest(sb, "resume", label, input, { atsAnalysis: analysis });
    if (!extraction) { res.status(502).json({ error: "Extraction failed." }); return; }
    res.status(200).json({ ok: true, extraction });
  } catch (e) {
    console.error("ingest failed:", e);
    res.status(502).json({ error: "Could not add to library." });
  }
}

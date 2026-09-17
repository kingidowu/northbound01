import { analyzeResume } from "../lib/ats-analysis.js";
import { getServiceClient, retrieveContext, ingest } from "../lib/knowledge.js";
import { rateLimit } from "../lib/ratelimit.js";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  if (!process.env.ANTHROPIC_API_KEY) { res.status(500).json({ error: "AI not configured" }); return; }
  const rl = await rateLimit(req, { limit: 10, windowMs: 60_000 });
  if (!rl.ok) { res.setHeader("Retry-After", rl.retryAfter); res.status(429).json({ error: "Too many requests. Please wait a minute." }); return; }

  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const resume = (body.resume || "").toString().slice(0, 30000).trim();
    const jd = (body.jobDescription || "").toString().slice(0, 12000).trim();
    if (resume.length < 80) { res.status(400).json({ error: "Please provide the full resume text (at least a few lines)." }); return; }

    const sb = getServiceClient();
    const learned = await retrieveContext(sb);
    const analysis = await analyzeResume(resume, jd, learned);
    analysis.score_basis = jd ? "Target job match" : "General ATS readiness";

    // Store exactly the score and role advice shown to the candidate.
    // Await this work so the serverless function cannot end before saving it.
    if (sb) await ingest(sb, "resume", "Resume check", resume, { atsAnalysis: analysis });
    res.status(200).json(analysis);
  } catch (e) {
    console.error("ATS analysis failed:", e);
    res.status(502).json({ error: "Analysis unavailable. Please try again." });
  }
}

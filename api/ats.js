import Anthropic from "@anthropic-ai/sdk";
import { getServiceClient, retrieveContext, ingest } from "../lib/knowledge.js";
import { rateLimit } from "../lib/ratelimit.js";

const client = new Anthropic(); // ANTHROPIC_API_KEY from Vercel env, never client-side

const SCHEMA = {
  type: "object",
  properties: {
    ats_score: { type: "integer", description: "0-100 estimate of how well this resume passes automated ATS screening." },
    verdict: { type: "string", description: "One-sentence headline read on the resume." },
    strengths: { type: "array", items: { type: "string" }, description: "What's working well (3-5)." },
    gaps: { type: "array", items: { type: "string" }, description: "Missing or weak areas hurting ATS performance (3-6)." },
    formatting_flags: { type: "array", items: { type: "string" }, description: "ATS-unfriendly formatting issues, e.g. tables, columns, graphics, headers/footers (may be empty)." },
    keywords_to_add: { type: "array", items: { type: "string" }, description: "Specific skills/keywords to add — drawn from the job description if one was given." },
    rewrite_tips: { type: "array", items: { type: "string" }, description: "Concrete, actionable rewrite suggestions (3-6), each one a specific change." },
  },
  required: ["ats_score", "verdict", "strengths", "gaps", "formatting_flags", "keywords_to_add", "rewrite_tips"],
  additionalProperties: false,
};

const SYSTEM = `You are an expert resume reviewer and ATS (Applicant Tracking System) specialist for The Career Architect.
Analyze the candidate's resume for how well it would pass automated screening AND read to a human recruiter.
If a target job description is provided, score keyword/skill alignment against it specifically.
Be specific and actionable — cite real gaps and concrete fixes, not generic advice. Be honest about the score but constructive in tone.`;

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

    const prompt = jd
      ? `RESUME:\n${resume}\n\nTARGET JOB DESCRIPTION:\n${jd}\n\nAnalyze ATS fit against this specific job.`
      : `RESUME:\n${resume}\n\nNo target job was provided. Analyze general ATS readiness.`;

    // Knowledge library: pull accumulated patterns to sharpen the review.
    const sb = getServiceClient();
    const learned = await retrieveContext(sb);

    const message = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 2000,
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM + learned,
      messages: [{ role: "user", content: prompt }],
    });

    const text = message.content.find((b) => b.type === "text")?.text || "{}";
    const data = JSON.parse(text);
    if (typeof data.ats_score === "number") data.ats_score = Math.max(0, Math.min(100, Math.round(data.ats_score)));
    res.status(200).json(data);

    // Store this resume in the knowledge library (after responding, best-effort).
    ingest(sb, "resume", "Resume check", resume).catch(() => {});
  } catch (e) {
    console.error("ATS analysis failed:", e);
    res.status(502).json({ error: "Analysis unavailable. Please try again." });
  }
}

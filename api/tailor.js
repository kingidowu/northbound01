import Anthropic from "@anthropic-ai/sdk";
import { rateLimit } from "../lib/ratelimit.js";

const client = new Anthropic();

const SCHEMA = {
  type: "object",
  properties: {
    keywords: { type: "array", items: { type: "string" }, description: "8-14 must-have skills, tools, and requirements pulled from the job description." },
    match_before: { type: "integer", description: "0-100: how well the ORIGINAL resume matches this job's requirements. 0 if no resume given." },
    match_after: { type: "integer", description: "0-100: how well the TAILORED resume matches. 0 if no resume given." },
    tailored_resume: { type: "string", description: "The candidate's resume rewritten and tailored to this job: ATS-friendly plain text, keywords worked in truthfully, quantified where possible. Empty string if no resume was provided." },
    changes: { type: "array", items: { type: "string" }, description: "Key tailoring changes and which keywords were incorporated. Empty if no resume." },
    coverage: { type: "string", description: "One short line on keyword coverage (e.g. 'Now aligns with 9 of the role's key requirements'), or, if no resume was given, 'Paste your resume to tailor it to these keywords.'" },
  },
  required: ["keywords", "match_before", "match_after", "tailored_resume", "changes", "coverage"],
  additionalProperties: false,
};

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  if (!process.env.ANTHROPIC_API_KEY) { res.status(500).json({ error: "AI not configured" }); return; }
  const rl = await rateLimit(req, { limit: 8, windowMs: 60_000 });
  if (!rl.ok) { res.setHeader("Retry-After", rl.retryAfter); res.status(429).json({ error: "Too many requests. Please wait a minute." }); return; }

  try {
    const b = req.body && typeof req.body === "object" ? req.body : {};
    const title = (b.jobTitle || "").toString().slice(0, 200).trim();
    const jd = (b.jobDescription || "").toString().slice(0, 12000).trim();
    const resume = (b.resume || "").toString().slice(0, 24000).trim();
    if (jd.length < 30) { res.status(400).json({ error: "No job description to read." }); return; }

    const task = resume.length >= 80
      ? "Extract the key requirements/keywords, then rewrite the candidate's resume to truthfully align with them (don't invent experience)."
      : "Extract the key requirements/keywords from the job. Leave tailored_resume empty and set coverage to ask for a resume.";

    const message = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 4000,
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      system: "You help a candidate target a specific job. Pull the real must-have keywords/skills from the job description, and (when a resume is given) rewrite it to align with them honestly and ATS-friendly. Never fabricate experience.",
      messages: [{
        role: "user",
        content: `JOB TITLE: ${title}\n\nJOB DESCRIPTION:\n${jd}\n\n${resume ? "CANDIDATE RESUME:\n" + resume : "No resume provided."}\n\n${task}`,
      }],
    });

    const text = message.content.find((x) => x.type === "text")?.text || "{}";
    const data = JSON.parse(text);
    data.match_before = Math.max(0, Math.min(100, Math.round(data.match_before || 0)));
    data.match_after = Math.max(0, Math.min(100, Math.round(data.match_after || 0)));
    res.status(200).json(data);
  } catch (e) {
    console.error("tailor failed:", e);
    res.status(502).json({ error: "Couldn't process. Try again." });
  }
}

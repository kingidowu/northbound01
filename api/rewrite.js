import Anthropic from "@anthropic-ai/sdk";
import { rateLimit } from "../lib/ratelimit.js";

const client = new Anthropic();

const SCHEMA = {
  type: "object",
  properties: {
    improved_resume: { type: "string", description: "The full rewritten, ATS-optimized resume in clean plain text with clear sections." },
    changes: { type: "array", items: { type: "string" }, description: "3-6 of the most important changes made and why." },
  },
  required: ["improved_resume", "changes"],
  additionalProperties: false,
};

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  if (!process.env.ANTHROPIC_API_KEY) { res.status(500).json({ error: "AI not configured" }); return; }
  const rl = await rateLimit(req, { limit: 6, windowMs: 60_000 });
  if (!rl.ok) { res.setHeader("Retry-After", rl.retryAfter); res.status(429).json({ error: "Too many requests. Please wait a minute." }); return; }

  try {
    const b = req.body && typeof req.body === "object" ? req.body : {};
    const resume = (b.resume || "").toString().slice(0, 24000).trim();
    const jd = (b.jobDescription || "").toString().slice(0, 10000).trim();
    if (resume.length < 80) { res.status(400).json({ error: "Provide the full resume text." }); return; }

    const message = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 4000,
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      system: "You are an expert resume writer. Rewrite the candidate's resume to be ATS-friendly and compelling: strong action verbs, quantified impact where possible (never invent facts), clean single-column plain-text formatting, relevant keywords, and tight bullets. Keep it truthful to the original - improve wording and structure, don't fabricate experience. If a job description is given, tailor wording/keywords to it.",
      messages: [{
        role: "user",
        content: `RESUME:\n${resume}\n\n${jd ? "TARGET JOB:\n" + jd : "No target job provided."}\n\nRewrite it.`,
      }],
    });

    const text = message.content.find((x) => x.type === "text")?.text || "{}";
    res.status(200).json(JSON.parse(text));
  } catch (e) {
    console.error("rewrite failed:", e);
    res.status(502).json({ error: "Couldn't rewrite. Try again." });
  }
}

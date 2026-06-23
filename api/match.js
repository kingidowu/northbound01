import Anthropic from "@anthropic-ai/sdk";
import { getServiceClient } from "../lib/knowledge.js";
import { rateLimit } from "../lib/ratelimit.js";

const client = new Anthropic();

const SCHEMA = {
  type: "object",
  properties: {
    matches: {
      type: "array",
      items: {
        type: "object",
        properties: {
          job_id: { type: "string" },
          score: { type: "integer", description: "0-100 fit score." },
          reason: { type: "string", description: "One sentence citing concrete overlaps or gaps." },
        },
        required: ["job_id", "score", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["matches"],
  additionalProperties: false,
};

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  if (!process.env.ANTHROPIC_API_KEY) { res.status(500).json({ error: "AI not configured" }); return; }
  const rl = await rateLimit(req, { limit: 8, windowMs: 60_000 });
  if (!rl.ok) { res.setHeader("Retry-After", rl.retryAfter); res.status(429).json({ error: "Too many requests. Please wait a minute." }); return; }

  try {
    const resume = (req.body?.resume || "").toString().slice(0, 20000).trim();
    if (resume.length < 80) { res.status(400).json({ error: "Paste your resume first (a few lines)." }); return; }

    const sb = getServiceClient();
    if (!sb) { res.status(500).json({ error: "Matching not configured" }); return; }

    const { data: jobs } = await sb
      .from("jobs")
      .select("id,title,company,category,work_mode,experience,location,visa_sponsorship,description")
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .limit(40);
    if (!jobs || !jobs.length) { res.status(200).json({ matches: [] }); return; }

    const list = jobs.map((j) =>
      `[${j.id}] ${j.title} @ ${j.company} | ${[j.category, j.work_mode, j.experience, j.location].filter(Boolean).join(" · ")}\n${(j.description || "").slice(0, 500)}`
    ).join("\n\n");

    const msg = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 4000,
      thinking: { type: "adaptive" }, // let it actually reason about fit
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      system: "You are an expert technical recruiter. Score how well the candidate's resume fits each job (0-100) and give one specific sentence citing concrete overlaps or gaps. Be discerning - reserve 80+ for genuinely strong fits and do not inflate. Only include jobs scoring 35 or above.",
      messages: [{ role: "user", content: `CANDIDATE RESUME:\n${resume}\n\nJOBS (id in brackets):\n${list}\n\nScore each job for this candidate.` }],
    });

    const text = msg.content.find((b) => b.type === "text")?.text || "{}";
    const data = JSON.parse(text);
    data.matches = (data.matches || [])
      .map((m) => ({ ...m, score: Math.max(0, Math.min(100, Math.round(m.score || 0))) }))
      .sort((a, b) => b.score - a.score);
    res.status(200).json(data);
  } catch (e) {
    console.error("match failed:", e);
    res.status(502).json({ error: "Matching unavailable. Try again." });
  }
}

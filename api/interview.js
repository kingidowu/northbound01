import Anthropic from "@anthropic-ai/sdk";
import { rateLimit } from "../lib/ratelimit.js";
import { gate, recordUse } from "../lib/entitlement.js";

const client = new Anthropic();

const SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          why_asked: { type: "string", description: "What the interviewer is really evaluating." },
          sample_answer: { type: "string", description: "A strong example answer, tailored to the candidate if a resume was given." },
        },
        required: ["question", "why_asked", "sample_answer"],
        additionalProperties: false,
      },
    },
    tips: { type: "array", items: { type: "string" }, description: "3-5 specific prep tips for this role." },
  },
  required: ["questions", "tips"],
  additionalProperties: false,
};

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  if (!process.env.ANTHROPIC_API_KEY) { res.status(500).json({ error: "AI not configured" }); return; }
  const rl = await rateLimit(req, { limit: 8, windowMs: 60_000 });
  if (!rl.ok) { res.setHeader("Retry-After", rl.retryAfter); res.status(429).json({ error: "Too many requests. Please wait a minute." }); return; }

  try {
    const b = req.body && typeof req.body === "object" ? req.body : {};
    const role = (b.role || "").toString().slice(0, 200).trim();
    const level = (b.level || "").toString().slice(0, 60).trim();
    const resume = (b.resume || "").toString().slice(0, 12000).trim();
    if (!role) { res.status(400).json({ error: "Enter the role you're interviewing for." }); return; }

    const g = await gate(req, "interview");
    if (!g.allowed) { res.status(g.status).json({ error: g.error, upgrade: g.upgrade, signIn: g.signIn }); return; }

    const message = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 3000,
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      system: "You are an expert interview coach. Produce a focused mock-interview prep: 6-8 of the most likely and important questions for the given role (mix behavioral, role-specific/technical, and situational), each with what the interviewer is really assessing and a strong sample answer. If a resume is provided, tailor sample answers to that background. Be specific and practical.",
      messages: [{
        role: "user",
        content: `ROLE: ${role}${level ? `\nLEVEL: ${level}` : ""}\n\n${resume ? "CANDIDATE RESUME:\n" + resume : "No resume provided."}\n\nGenerate the interview prep.`,
      }],
    });

    const text = message.content.find((x) => x.type === "text")?.text || "{}";
    const data = JSON.parse(text);
    await recordUse(g);
    if (g && g.plan === "free") data._credits = { used: (g.used || 0) + 1, limit: g.limit };
    res.status(200).json(data);
  } catch (e) {
    console.error("interview failed:", e);
    res.status(502).json({ error: "Couldn't generate prep. Try again." });
  }
}

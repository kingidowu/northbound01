import Anthropic from "@anthropic-ai/sdk";
import { rateLimit } from "../lib/ratelimit.js";
import { gate, recordUse } from "../lib/entitlement.js";

const client = new Anthropic();

const SCHEMA = {
  type: "object",
  properties: {
    market_range: { type: "string", description: "Realistic market pay range for this role/level/location (remote US/Canada when applicable), e.g. '$115k-$145k base'." },
    assessment: { type: "string", description: "1-2 sentences on how the current offer compares to market: low, fair, or strong, and why." },
    target: { type: "string", description: "The specific number or tight range to counter with, with brief reasoning." },
    counter_email: { type: "string", description: "A ready-to-send, professional counter-offer email the candidate can copy, warm and confident, not aggressive." },
    talking_points: { type: "array", items: { type: "string" }, description: "3-5 concise justifications the candidate can use to support the ask." },
    also_negotiate: { type: "array", items: { type: "string" }, description: "3-5 levers beyond base salary worth negotiating (signing bonus, equity, PTO, remote, start date, learning budget)." },
    dos: { type: "array", items: { type: "string" }, description: "2-4 short do's." },
    donts: { type: "array", items: { type: "string" }, description: "2-4 short don'ts." },
  },
  required: ["market_range", "assessment", "target", "counter_email", "talking_points", "also_negotiate", "dos", "donts"],
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
    const offer = (b.offer || "").toString().slice(0, 120).trim();
    const location = (b.location || "").toString().slice(0, 120).trim();
    const experience = (b.experience || "").toString().slice(0, 60).trim();
    const context = (b.context || "").toString().slice(0, 1500).trim();
    if (role.length < 2 || offer.length < 1) {
      res.status(400).json({ error: "Tell us the role and the offer amount." });
      return;
    }

    const g = await gate(req, "salary");
    if (!g.allowed) { res.status(g.status).json({ error: g.error, upgrade: g.upgrade, signIn: g.signIn }); return; }

    const message = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 3000,
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      system:
        "You are a sharp, supportive salary-negotiation coach for IT, cloud, and healthcare-tech professionals (remote US/Canada focus). Given an offer, assess it against market honestly, recommend a specific counter target, and write a professional counter-offer email that is confident but collaborative. Be realistic, never reckless. Account for the candidate's leverage and context. Keep advice concrete and usable.",
      messages: [{
        role: "user",
        content: `ROLE: ${role}\nOFFER: ${offer}\nLOCATION: ${location || "(remote / not specified)"}\nEXPERIENCE: ${experience || "(not specified)"}\nCONTEXT (competing offers, situation, what they want): ${context || "(none provided)"}\n\nCoach me through countering this offer.`,
      }],
    });

    const text = message.content.find((x) => x.type === "text")?.text || "{}";
    const data = JSON.parse(text);
    await recordUse(g);
    if (g && g.plan === "free") data._credits = { used: (g.used || 0) + 1, limit: g.limit };
    res.status(200).json(data);
  } catch (e) {
    console.error("salary failed:", e);
    res.status(502).json({ error: "Couldn't generate your strategy. Try again." });
  }
}

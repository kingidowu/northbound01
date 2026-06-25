import Anthropic from "@anthropic-ai/sdk";
import { rateLimit } from "../lib/ratelimit.js";
import { gate, recordUse } from "../lib/entitlement.js";

const client = new Anthropic();

const SCHEMA = {
  type: "object",
  properties: {
    headlines: { type: "array", items: { type: "string" }, description: "3 strong LinkedIn headline options (each under 220 chars), keyword-rich and tuned for recruiter search." },
    about: { type: "string", description: "A rewritten LinkedIn About/summary section: first person, compelling, ATS/recruiter-keyword aware, 3-5 short paragraphs." },
    keywords: { type: "array", items: { type: "string" }, description: "8-14 keywords/skills recruiters search for this target role that should appear on the profile." },
    tips: { type: "array", items: { type: "string" }, description: "4-6 specific profile-optimization tips (skills section, experience bullets, featured, open-to-work, etc.)." },
  },
  required: ["headlines", "about", "keywords", "tips"],
  additionalProperties: false,
};

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  if (!process.env.ANTHROPIC_API_KEY) { res.status(500).json({ error: "AI not configured" }); return; }
  const rl = await rateLimit(req, { limit: 8, windowMs: 60_000 });
  if (!rl.ok) { res.setHeader("Retry-After", rl.retryAfter); res.status(429).json({ error: "Too many requests. Please wait a minute." }); return; }

  try {
    const b = req.body && typeof req.body === "object" ? req.body : {};
    const target = (b.target || "").toString().slice(0, 200).trim();
    const headline = (b.headline || "").toString().slice(0, 400).trim();
    const about = (b.about || "").toString().slice(0, 4000).trim();
    const experience = (b.experience || "").toString().slice(0, 60).trim();
    if (target.length < 2 && about.length < 20 && headline.length < 5) {
      res.status(400).json({ error: "Tell us your target role and a bit about your current profile." });
      return;
    }

    const g = await gate(req, "linkedin");
    if (!g.allowed) { res.status(g.status).json({ error: g.error, upgrade: g.upgrade, signIn: g.signIn }); return; }

    const message = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 3000,
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      system:
        "You are a LinkedIn personal-branding expert for IT, cloud, and healthcare-tech professionals targeting remote roles in the US and Canada. Rewrite the person's headline and About section to be compelling and optimized for recruiter search, working in the keywords recruiters actually filter on. Be truthful to their background, specific, and human (not buzzword soup). Output ready-to-paste copy.",
      messages: [{
        role: "user",
        content: `TARGET ROLE: ${target || "(not specified)"}\nEXPERIENCE: ${experience || "(not specified)"}\n\nCURRENT HEADLINE:\n${headline || "(none)"}\n\nCURRENT ABOUT:\n${about || "(none)"}\n\nOptimize my LinkedIn profile.`,
      }],
    });

    const text = message.content.find((x) => x.type === "text")?.text || "{}";
    const data = JSON.parse(text);
    await recordUse(g);
    if (g && g.plan === "free") data._credits = { used: (g.used || 0) + 1, limit: g.limit };
    res.status(200).json(data);
  } catch (e) {
    console.error("linkedin failed:", e);
    res.status(502).json({ error: "Couldn't optimize your profile. Try again." });
  }
}

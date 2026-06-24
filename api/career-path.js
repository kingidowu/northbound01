import Anthropic from "@anthropic-ai/sdk";
import { rateLimit } from "../lib/ratelimit.js";

const client = new Anthropic();

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "1-2 sentence read on where the person is and their strongest direction." },
    paths: {
      type: "array",
      description: "Exactly 3 distinct, realistic career paths from the person's current position.",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Target role, e.g. 'Cloud Engineer'." },
          fit: { type: "string", enum: ["Strong fit", "Stretch", "Bold pivot"], description: "How big a leap this is from where they are." },
          why: { type: "string", description: "1-2 sentences on why this path suits them, referencing their background." },
          salary_range: { type: "string", description: "Realistic US/Canada remote salary range, e.g. '$95k-$140k'." },
          timeline: { type: "string", description: "Realistic time to land the role, e.g. '6-12 months'." },
          steps: { type: "array", items: { type: "string" }, description: "3-5 concrete steps in order." },
          certifications: { type: "array", items: { type: "string" }, description: "1-3 certs or credentials that accelerate this path." },
          first_action: { type: "string", description: "The single most useful thing to do this week." },
        },
        required: ["title", "fit", "why", "salary_range", "timeline", "steps", "certifications", "first_action"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "paths"],
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
    const skills = (b.skills || "").toString().slice(0, 2000).trim();
    const experience = (b.experience || "").toString().slice(0, 60).trim();
    const interest = (b.interest || "").toString().slice(0, 400).trim();
    if (role.length < 2 && skills.length < 10) {
      res.status(400).json({ error: "Tell us your current role and a few skills." });
      return;
    }

    const message = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 3000,
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      system:
        "You are a sharp career strategist for IT, cloud computing, and healthcare-tech professionals in the US and Canada, focused on remote roles. Given someone's current role and skills, map exactly 3 distinct, realistic next career paths: typically one Strong fit (natural next step), one Stretch (ambitious but reachable), and one Bold pivot. Be specific and practical: real role titles, honest US/Canada remote salary ranges, realistic timelines, concrete steps, and the certifications that actually move the needle (e.g. AWS, Azure, CompTIA, Epic). Never overpromise. Reference the person's actual background in each 'why'.",
      messages: [{
        role: "user",
        content: `CURRENT ROLE: ${role || "(not given)"}\nEXPERIENCE LEVEL: ${experience || "(not given)"}\nSKILLS: ${skills || "(not given)"}\nINTERESTS / GOALS: ${interest || "(none specified)"}\n\nMap 3 career paths.`,
      }],
    });

    const text = message.content.find((x) => x.type === "text")?.text || "{}";
    res.status(200).json(JSON.parse(text));
  } catch (e) {
    console.error("career-path failed:", e);
    res.status(502).json({ error: "Couldn't map your paths. Try again." });
  }
}

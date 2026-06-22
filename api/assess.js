import Anthropic from "@anthropic-ai/sdk";

// The API key lives ONLY here, server-side, read from a Vercel environment
// variable. It must never appear in index.html or any client-shipped code.
const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

// Structured-output schema — guarantees the model returns exactly these fields.
const SCHEMA = {
  type: "object",
  properties: {
    snapshot: {
      type: "string",
      description:
        "2-3 sentence honest read on where this person stands today and how achievable their goal is, tuned to their field and experience.",
    },
    target_roles: {
      type: "array",
      items: { type: "string" },
      description: "3-4 specific job titles or next-step roles to aim for, given their background and goals.",
    },
    next_step: {
      type: "string",
      description:
        "The single most valuable concrete next move they should make this week, given their answers (e.g. fix a specific resume gap, target a role type, address their biggest obstacle). 2-3 sentences, specific and actionable.",
    },
  },
  required: ["snapshot", "target_roles", "next_step"],
  additionalProperties: false,
};

const SYSTEM = `You are a career strategist for The Career Architect, a general career-services company helping people in any field and at any stage — promotions, job changes, career pivots, returning to work, breaking in.
Given a person's assessment answers, produce an honest, encouraging, specific instant snapshot.
Be realistic — do not over-promise — but stay constructive and actionable. Avoid generic filler. Tailor everything to their actual field, experience, goals, and stated obstacles.`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: "AI not configured" });
    return;
  }

  try {
    const a = req.body && typeof req.body === "object" ? req.body : {};

    // Build a compact profile from the assessment answers (general career —
    // tolerant of whichever fields the form sends).
    const profile = [
      ["Current title", a.current_title],
      ["Industry / field", a.field || a.industry],
      ["Experience", a.experience],
      ["Current situation", a.status || a.situation],
      ["Career goal", a.goal || a.primary_goal],
      ["Target role(s)", a.target_role],
      ["Key skills / strengths", a.skills || a.strengths],
      ["Areas to improve", a.improve],
      ["Education", a.education],
      ["Confidence (1-10)", a.confidence || a.satisfaction],
      ["Resume effectiveness", a.resume_effectiveness],
      ["Applications (30 days)", a.applications],
      ["After applying", a.after_applying],
      ["Work preference", a.work_pref],
      ["Lives in", a.country],
      ["Target salary", a.salary],
      ["Timeline", a.timeline],
      ["Biggest obstacle", a.obstacle],
      ["Wants help with", Array.isArray(a.help) ? a.help.join(", ") : a.help],
      ["Biggest challenges", Array.isArray(a.challenges) ? a.challenges.join(", ") : a.challenges],
      ["Notes", a.notes],
    ]
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");

    const message = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1500,
      output_config: {
        effort: "low", // keep this snappy — it runs on form submit
        format: { type: "json_schema", schema: SCHEMA },
      },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `Here is the candidate's assessment:\n\n${profile || "(no answers provided)"}\n\nGenerate their snapshot.`,
        },
      ],
    });

    const text = message.content.find((b) => b.type === "text")?.text || "{}";
    res.status(200).json(JSON.parse(text));
  } catch (e) {
    console.error("AI snapshot failed:", e);
    res.status(502).json({ error: "AI snapshot unavailable" });
  }
}

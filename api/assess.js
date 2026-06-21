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
        "2-3 sentence read on where this person stands today and how realistic a sponsored remote US/Canada role is.",
    },
    target_roles: {
      type: "array",
      items: { type: "string" },
      description: "3-4 specific job titles to aim for, tuned to their field and experience.",
    },
    sponsorship_pitch: {
      type: "string",
      description:
        "A short, recruiter-ready way for them to raise visa sponsorship that strengthens their candidacy. 2-3 sentences, written in the first person so they can use it directly.",
    },
  },
  required: ["snapshot", "target_roles", "sponsorship_pitch"],
  additionalProperties: false,
};

const SYSTEM = `You are a career strategist for Northbound, which helps IT professionals land remote, visa-sponsored roles in the US and Canada (DevOps, Cloud, Data, Software, AI/ML).
Given a candidate's assessment answers, produce an honest, encouraging, specific instant snapshot.
Be realistic about the sponsorship market — do not over-promise — but stay constructive and actionable. Avoid generic filler. Tailor everything to their field, experience, and work authorization.`;

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

    // Build a compact profile from the assessment answers.
    const profile = [
      ["Field", a.field],
      ["Target role", a.target_role],
      ["Experience", a.experience],
      ["Key skills", a.skills],
      ["Education", a.education],
      ["Current title", a.current_title],
      ["Work authorization", a.work_auth],
      ["Needs sponsorship", a.needs_sponsorship],
      ["Target country", a.target_country],
      ["Work preference", a.work_pref],
      ["Lives in", a.country],
      ["Target salary", a.salary],
      ["Timeline", a.timeline],
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

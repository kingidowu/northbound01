import Anthropic from "@anthropic-ai/sdk";
import { rateLimit } from "../lib/ratelimit.js";

const client = new Anthropic(); // ANTHROPIC_API_KEY from Vercel env, server-only

const SYSTEM = `You write short, sincere, specific cover notes for job applicants at The Career Architect.
Rules: 3-5 sentences, first person, warm but professional, no clichés ("I am writing to apply"), no flattery padding.
Tie the candidate's background to what the role needs. If the background is thin, keep it honest and enthusiastic. Output ONLY the note text.`;

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  if (!process.env.ANTHROPIC_API_KEY) { res.status(500).json({ error: "AI not configured" }); return; }
  const rl = await rateLimit(req, { limit: 12, windowMs: 60_000 });
  if (!rl.ok) { res.setHeader("Retry-After", rl.retryAfter); res.status(429).json({ error: "Too many requests. Please wait a minute." }); return; }

  try {
    const b = req.body && typeof req.body === "object" ? req.body : {};
    const title = (b.job_title || "").toString().slice(0, 200);
    const company = (b.company || "").toString().slice(0, 200);
    const desc = (b.description || "").toString().slice(0, 6000);
    const background = (b.background || "").toString().slice(0, 8000);
    if (!title) { res.status(400).json({ error: "Missing job info" }); return; }

    const msg = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 500,
      output_config: { effort: "low" },
      system: SYSTEM,
      messages: [{
        role: "user",
        content: `ROLE: ${title} at ${company}\n\nJOB DESCRIPTION:\n${desc || "(not provided)"}\n\nCANDIDATE BACKGROUND (resume / notes):\n${background || "(not provided)"}\n\nWrite the cover note.`,
      }],
    });
    const note = msg.content.find((x) => x.type === "text")?.text?.trim() || "";
    res.status(200).json({ cover_note: note });
  } catch (e) {
    console.error("cover note failed:", e);
    res.status(502).json({ error: "Could not draft a note. Try again." });
  }
}

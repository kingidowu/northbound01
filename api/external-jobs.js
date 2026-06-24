import Anthropic from "@anthropic-ai/sdk";
import { rateLimit } from "../lib/ratelimit.js";

const ai = new Anthropic();

// Keep only jobs relevant to the platform's focus (IT/software/cloud/data/cyber/healthcare).
async function filterRelevant(jobs) {
  if (!process.env.ANTHROPIC_API_KEY || !jobs.length) return jobs;
  try {
    const list = jobs.map((j, i) => `[${i}] ${j.title} — ${(j.description || "").slice(0, 100)}`).join("\n");
    const msg = await ai.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 400,
      output_config: { format: { type: "json_schema", schema: { type: "object", properties: { keep: { type: "array", items: { type: "integer" } } }, required: ["keep"], additionalProperties: false } } },
      system: "You curate a careers platform focused on IT, software, cloud/DevOps, data/AI, cybersecurity, and healthcare roles across the US and Canada. Return the indices of jobs that genuinely fit that focus; drop unrelated roles.",
      messages: [{ role: "user", content: `Jobs:\n${list}\n\nReturn the indices to keep.` }],
    });
    const t = msg.content.find((b) => b.type === "text")?.text || "{}";
    const keep = new Set(JSON.parse(t).keep || []);
    const filtered = jobs.filter((_, i) => keep.has(i));
    return filtered.length ? filtered : jobs;
  } catch (e) { console.error("relevance filter failed:", e); return jobs; }
}

// Pulls live job listings from Adzuna (free API). Keys are server-side env vars.
// Sign up at https://developer.adzuna.com -> ADZUNA_APP_ID + ADZUNA_APP_KEY.
export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }
  const rl = await rateLimit(req, { limit: 30, windowMs: 60_000 });
  if (!rl.ok) { res.setHeader("Retry-After", rl.retryAfter); res.status(429).json({ error: "Too many requests." }); return; }

  const APP_ID = process.env.ADZUNA_APP_ID;
  const APP_KEY = process.env.ADZUNA_APP_KEY;
  if (!APP_ID || !APP_KEY) { res.status(200).json({ jobs: [], configured: false }); return; }

  try {
    const q = req.method === "POST" ? (req.body || {}) : (req.query || {});
    const what = (q.what || "").toString().slice(0, 120).trim();
    const where = (q.where || "").toString().slice(0, 120).trim();
    const country = ["us", "ca", "gb"].includes((q.country || "").toString()) ? q.country : "us";
    const remote = q.remote !== false && q.remote !== "false"; // default to remote-only

    const whatQ = remote ? (what ? what + " remote" : "remote") : what;
    const url = new URL(`https://api.adzuna.com/v1/api/jobs/${country}/search/1`);
    url.searchParams.set("app_id", APP_ID);
    url.searchParams.set("app_key", APP_KEY);
    url.searchParams.set("results_per_page", "30");
    url.searchParams.set("content-type", "application/json");
    if (whatQ) url.searchParams.set("what", whatQ);
    if (where) url.searchParams.set("where", where);

    const r = await fetch(url);
    if (!r.ok) { res.status(502).json({ error: "Job source error", jobs: [] }); return; }
    const data = await r.json();

    const jobs = (data.results || []).map((j) => ({
      id: "web-" + j.id,
      external: true,
      title: j.title || "",
      company: j.company?.display_name || "",
      location: j.location?.display_name || "",
      category: j.category?.label || "",
      work_mode: /remote/i.test((j.title || "") + (j.description || "")) ? "Remote" : "",
      employment_type: j.contract_time === "part_time" ? "Part-time" : j.contract_time === "full_time" ? "Full-time" : "",
      salary_min: j.salary_min ? Math.round(j.salary_min) : null,
      salary_max: j.salary_max ? Math.round(j.salary_max) : null,
      salary_currency: country === "ca" ? "CAD" : country === "gb" ? "GBP" : "USD",
      description: (j.description || "").replace(/\s+/g, " ").trim(),
      apply_url: j.redirect_url || "",
      created_at: j.created || null,
    }));

    // Keep only genuinely-remote roles.
    let out = remote
      ? jobs.filter((j) => /\b(remote|work[ -]?from[ -]?home|wfh|telecommut|fully distributed)\b/i.test(j.title + " " + j.description)).map((j) => ({ ...j, work_mode: "Remote" }))
      : jobs;
    if (q.relevance) out = await filterRelevant(out);
    res.status(200).json({ jobs: out, configured: true, count: out.length });
  } catch (e) {
    console.error("external-jobs failed:", e);
    res.status(502).json({ error: "Could not load web jobs", jobs: [] });
  }
}

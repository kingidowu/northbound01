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

// ---- Source 1: Adzuna (needs ADZUNA_APP_ID + ADZUNA_APP_KEY) ----
async function fetchAdzuna(what, where, country, remote) {
  const APP_ID = process.env.ADZUNA_APP_ID, APP_KEY = process.env.ADZUNA_APP_KEY;
  if (!APP_ID || !APP_KEY) return [];
  const ac = ["us", "ca", "gb"].includes(country) ? country : "us";
  const whatQ = remote ? (what ? what + " remote" : "remote") : what;
  const url = new URL(`https://api.adzuna.com/v1/api/jobs/${ac}/search/1`);
  url.searchParams.set("app_id", APP_ID);
  url.searchParams.set("app_key", APP_KEY);
  url.searchParams.set("results_per_page", "50");
  url.searchParams.set("content-type", "application/json");
  if (whatQ) url.searchParams.set("what", whatQ);
  if (where) url.searchParams.set("where", where);
  try {
    const r = await fetch(url);
    if (!r.ok) return [];
    const data = await r.json();
    return (data.results || []).map((j) => ({
      id: "web-" + j.id, external: true, source: "Adzuna",
      title: j.title || "", company: j.company?.display_name || "",
      location: j.location?.display_name || "", category: j.category?.label || "",
      work_mode: /remote/i.test((j.title || "") + (j.description || "")) ? "Remote" : "",
      employment_type: j.contract_time === "part_time" ? "Part-time" : j.contract_time === "full_time" ? "Full-time" : "",
      salary_min: j.salary_min ? Math.round(j.salary_min) : null,
      salary_max: j.salary_max ? Math.round(j.salary_max) : null,
      salary_currency: ac === "ca" ? "CAD" : ac === "gb" ? "GBP" : "USD",
      description: (j.description || "").replace(/\s+/g, " ").trim(),
      apply_url: j.redirect_url || "", created_at: j.created || null,
    }));
  } catch (e) { console.error("Adzuna failed:", e); return []; }
}

// ---- Source 2: Remotive (free, no key, all roles fully remote) ----
async function fetchRemotive(what, country) {
  try {
    const url = new URL("https://remotive.com/api/remote-jobs");
    if (what) url.searchParams.set("search", what);
    url.searchParams.set("limit", "40");
    const r = await fetch(url, { headers: { "User-Agent": "TheCareerArchitect/1.0" } });
    if (!r.ok) return [];
    const data = await r.json();
    const okLoc = (loc) => {
      const l = (loc || "").toLowerCase();
      if (!l) return true;
      if (country === "ca") return /canada|worldwide|anywhere|americas|north america/.test(l);
      return /usa|united states|worldwide|anywhere|americas|north america|us only|us-/.test(l) || !/(europe|emea|asia|india|uk only|latam only|africa)/.test(l);
    };
    return (data.jobs || [])
      .filter((j) => okLoc(j.candidate_required_location))
      .map((j) => ({
        id: "rmtv-" + j.id, external: true, source: "Remotive",
        title: j.title || "", company: j.company_name || "",
        location: j.candidate_required_location || "Remote", category: j.category || "",
        work_mode: "Remote",
        employment_type: /part/i.test(j.job_type || "") ? "Part-time" : "Full-time",
        salary_min: null, salary_max: null, salary_currency: "USD",
        description: (j.description || "").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim(),
        apply_url: j.url || "", created_at: j.publication_date || null,
      }));
  } catch (e) { console.error("Remotive failed:", e); return []; }
}

// Pulls live job listings from multiple free sources (Adzuna + Remotive), merges
// and de-duplicates them. Adds many more remote IT/cloud/healthcare-tech roles.
export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }
  const rl = await rateLimit(req, { limit: 30, windowMs: 60_000 });
  if (!rl.ok) { res.setHeader("Retry-After", rl.retryAfter); res.status(429).json({ error: "Too many requests." }); return; }

  try {
    const q = req.method === "POST" ? (req.body || {}) : (req.query || {});
    const what = (q.what || "").toString().slice(0, 120).trim();
    const where = (q.where || "").toString().slice(0, 120).trim();
    const country = ["us", "ca", "gb"].includes((q.country || "").toString()) ? q.country : "us";
    const remote = q.remote !== false && q.remote !== "false";

    const [adz, rmt] = await Promise.all([
      fetchAdzuna(what, where, country, remote),
      fetchRemotive(what, country),
    ]);

    // Merge + de-dupe by title+company.
    const seen = new Set();
    let merged = [...rmt, ...adz].filter((j) => {
      const k = (j.title + "|" + j.company).toLowerCase().replace(/\s+/g, " ").trim();
      if (!j.title || seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    // Prefer genuinely-remote roles when remote is requested (Remotive is always remote).
    if (remote) {
      const detected = merged.filter((j) => j.source === "Remotive" || /\b(remote|work[ -]?from[ -]?home|wfh|telecommut|fully distributed|anywhere)\b/i.test(j.title + " " + j.description));
      if (detected.length) merged = detected;
    }

    if (q.relevance) merged = await filterRelevant(merged);
    merged = merged.slice(0, 60);
    res.status(200).json({ jobs: merged, configured: true, count: merged.length });
  } catch (e) {
    console.error("external-jobs failed:", e);
    res.status(502).json({ error: "Could not load web jobs", jobs: [] });
  }
}

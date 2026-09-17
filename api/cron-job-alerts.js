import { getServiceClient } from "../lib/knowledge.js";

// Daily cron (configured in vercel.json). For each saved search, fetches fresh
// jobs from the aggregated board and emails the user any new matches.
const SITE = "https://thecareerarchitect.org";
const FROM = process.env.FROM_EMAIL || "The Career Architect <angel@thecareerarchitect.org>";
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = (u) => (/^https?:/i.test(String(u || "").trim()) ? String(u).trim() : `${SITE}/jobs.html`);

async function sendAlert(to, what, jobs) {
  if (!process.env.RESEND_API_KEY || !to) return;
  const rows = jobs.map((j) => `
    <tr><td style="padding:.7rem 0;border-bottom:1px solid #e5e3da">
      <a href="${safeUrl(j.apply_url)}" style="color:#0E1733;font-weight:600;text-decoration:none">${esc(j.title)}</a>
      <div style="color:#5A6280;font-size:.9rem">${esc(j.company)}${j.location ? " · " + esc(j.location) : ""}${j.source ? " · " + esc(j.source) : ""}</div>
    </td></tr>`).join("");
  const html = `<div style="font-family:Inter,Arial,sans-serif;color:#0E1733;max-width:560px;margin:auto">
    <div style="font-family:'Space Grotesk',Arial;font-weight:700;font-size:1.1rem;margin-bottom:.4rem">The Career Architect</div>
    <p><b>${jobs.length} new ${esc(what)} ${jobs.length === 1 ? "role" : "roles"}</b> matching your alert:</p>
    <table style="width:100%;border-collapse:collapse">${rows}</table>
    <p style="margin-top:1.2rem"><a href="${SITE}/jobs.html" style="color:#16895B">See all jobs →</a></p>
    <hr style="border:none;border-top:1px solid #e5e3da;margin:1.5rem 0">
    <div style="font-size:.78rem;color:#5A6280">You're getting this because you set a job alert. Manage or turn it off in <a href="${SITE}/seeker.html" style="color:#5A6280">your account</a>.</div>
  </div>`;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to, subject: `${jobs.length} new ${what} ${jobs.length === 1 ? "job" : "jobs"} for you`, html }),
  }).catch((e) => console.error("resend alert:", e));
}

export default async function handler(req, res) {
  // Vercel cron sends Authorization: Bearer ${CRON_SECRET} when CRON_SECRET is set.
  const secret = process.env.CRON_SECRET;
  if (secret && (req.headers.authorization || "") !== `Bearer ${secret}`) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const sb = getServiceClient();
  if (!sb) { res.status(503).json({ error: "not configured" }); return; }

  let processed = 0, sent = 0;
  try {
    const { data: searches } = await sb.from("saved_searches").select("*").eq("active", true).limit(1000);
    for (const s of searches || []) {
      processed++;
      try {
        const sponsorship = String(s.what||"").startsWith("visa:");
        const focus = sponsorship ? String(s.what).slice(5).trim() : s.what;
        const r = await fetch(`${SITE}/api/external-jobs`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ what: focus, country: s.country || "us", relevance: false, sponsorship, remote: !sponsorship }),
        });
        const d = await r.json();
        const jobs = d.jobs || [];
        const seen = new Set(s.seen_ids || []);
        const fresh = jobs.filter((j) => j.id && !seen.has(j.id)).slice(0, 8);
        if (fresh.length) {
          await sendAlert(s.email, sponsorship ? (focus ? `visa-sponsored ${focus}` : "visa sponsorship") : s.what, fresh);
          sent++;
        }
        const newSeen = [...new Set([...jobs.map((j) => j.id), ...(s.seen_ids || [])])].filter(Boolean).slice(0, 300);
        await sb.from("saved_searches").update({ seen_ids: newSeen, last_run: new Date().toISOString() }).eq("id", s.id);
      } catch (e) {
        console.error("alert failed for", s.id, e);
      }
    }
    res.status(200).json({ ok: true, processed, sent });
  } catch (e) {
    console.error("cron-job-alerts failed:", e);
    res.status(500).json({ error: "cron failed", processed, sent });
  }
}

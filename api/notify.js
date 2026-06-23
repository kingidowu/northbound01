import { getServiceClient } from "../lib/knowledge.js";

// Called by Supabase Database Webhooks on insert/update of applications &
// assessments. Sends notification emails via Resend. Secret-protected.
const FROM = process.env.FROM_EMAIL || "The Career Architect <hello@thecareerarchitect.org>";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "timsidowu@gmail.com";
const SITE = "https://thecareerarchitect.org";

async function sendEmail(to, subject, html) {
  if (!process.env.RESEND_API_KEY) { console.warn("RESEND_API_KEY not set; skipping email"); return; }
  if (!to) return;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  });
  if (!r.ok) console.error("Resend error:", await r.text());
}

const wrap = (body) =>
  `<div style="font-family:Inter,Arial,sans-serif;color:#0E1733;max-width:560px;margin:auto">
     <div style="font-family:'Space Grotesk',Arial;font-weight:700;font-size:1.1rem;margin-bottom:1rem">The Career Architect</div>
     ${body}
     <hr style="border:none;border-top:1px solid #e5e3da;margin:1.5rem 0">
     <div style="font-size:.8rem;color:#5A6280">${SITE}</div>
   </div>`;

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  if (process.env.NOTIFY_SECRET && req.headers["x-notify-secret"] !== process.env.NOTIFY_SECRET) {
    res.status(403).json({ error: "forbidden" }); return;
  }

  try {
    const b = req.body && typeof req.body === "object" ? req.body : {};
    const { type, table, record, old_record } = b;
    const sb = getServiceClient();

    if (table === "applications" && type === "INSERT" && record) {
      // Look up the job + the recruiter's email.
      let title = "a role", recruiterEmail = null;
      if (sb && record.job_id) {
        const { data: job } = await sb.from("jobs").select("title, agent_id").eq("id", record.job_id).maybeSingle();
        if (job) {
          title = job.title || title;
          const { data: prof } = await sb.from("agent_profiles").select("email").eq("id", job.agent_id).maybeSingle();
          recruiterEmail = prof?.email || null;
        }
      }
      // 1) recruiter
      await sendEmail(recruiterEmail, `New application: ${title}`, wrap(
        `<p>You have a new applicant for <b>${title}</b>.</p>
         <p><b>${record.applicant_name}</b> · ${record.applicant_email}${record.applicant_phone ? " · " + record.applicant_phone : ""}</p>
         ${record.cover_note ? `<p style="color:#5A6280">"${record.cover_note}"</p>` : ""}
         <p><a href="${SITE}/agent.html" style="color:#16895B">Review in your dashboard →</a></p>`));
      // 2) candidate confirmation
      await sendEmail(record.applicant_email, `Application received: ${title}`, wrap(
        `<p>Hi ${record.applicant_name?.split(" ")[0] || "there"},</p>
         <p>We've received your application for <b>${title}</b>. The recruiter has been notified. Good luck!</p>
         <p><a href="${SITE}/seeker.html" style="color:#16895B">Track your applications →</a></p>`));
    }

    if (table === "applications" && type === "UPDATE" && record && old_record && record.status !== old_record.status) {
      let title = "your application";
      if (sb && record.job_id) {
        const { data: job } = await sb.from("jobs").select("title").eq("id", record.job_id).maybeSingle();
        title = job?.title || title;
      }
      await sendEmail(record.applicant_email, `Update on your application: ${title}`, wrap(
        `<p>Hi ${record.applicant_name?.split(" ")[0] || "there"},</p>
         <p>Your application for <b>${title}</b> is now marked: <b>${record.status}</b>.</p>
         <p><a href="${SITE}/seeker.html" style="color:#16895B">View your applications →</a></p>`));
    }

    if (table === "assessments" && type === "INSERT" && record) {
      await sendEmail(ADMIN_EMAIL, `New assessment: ${record.full_name || "Unknown"}`, wrap(
        `<p>New career assessment submitted.</p>
         <p><b>${record.full_name || "—"}</b>${record.email ? " · " + record.email : ""}${record.field ? " · " + record.field : ""}</p>
         <p><a href="${SITE}/admin.html" style="color:#16895B">View in admin →</a></p>`));
    }

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error("notify failed:", e);
    res.status(200).json({ ok: false }); // 200 so Supabase doesn't retry-storm
  }
}

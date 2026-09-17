import { getServiceClient } from "../lib/knowledge.js";

// Server-rendered job page carrying Google "JobPosting" structured data so the
// role can appear in the Google for Jobs widget. Crawlable URL: /job/:id
const SITE = "https://thecareerarchitect.org";
const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Only allow safe link schemes - blocks javascript:/data: XSS in apply links.
const safeUrl = (u) => (/^(https?:|mailto:)/i.test(String(u || "").trim()) ? String(u).trim() : null);

const EMP_TYPE = {
  "full-time": "FULL_TIME", "fulltime": "FULL_TIME",
  "part-time": "PART_TIME", "parttime": "PART_TIME",
  contract: "CONTRACTOR", contractor: "CONTRACTOR",
  temporary: "TEMPORARY", internship: "INTERN", intern: "INTERN",
};

function brandSvg(fill = "#1C2748") {
  return `<svg width="24" height="24" viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="9" fill="${fill}"/><path d="M11 30 L20 11 L29 30" fill="none" stroke="#27C285" stroke-width="3.4" stroke-linejoin="round" stroke-linecap="round"/><line x1="15" y1="23.5" x2="25" y2="23.5" stroke="#27C285" stroke-width="3" stroke-linecap="round"/><circle cx="20" cy="10" r="2.4" fill="#D99A28"/></svg>`;
}

function shell(title, desc, canonical, head, body) {
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}"/>
<link rel="canonical" href="${canonical}"/>
<meta property="og:type" content="website"/>
<meta property="og:title" content="${esc(title)}"/>
<meta property="og:description" content="${esc(desc)}"/>
<meta property="og:url" content="${canonical}"/>
<meta name="theme-color" content="#0E1733"/>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Crect width='40' height='40' rx='9' fill='%230E1733'/%3E%3Cpath d='M11 30 L20 11 L29 30' fill='none' stroke='%2327C285' stroke-width='3.4' stroke-linejoin='round' stroke-linecap='round'/%3E%3Cline x1='15' y1='23.5' x2='25' y2='23.5' stroke='%2327C285' stroke-width='3' stroke-linecap='round'/%3E%3Ccircle cx='20' cy='10' r='2.4' fill='%23D99A28'/%3E%3C/svg%3E"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet"/>
<link rel="stylesheet" href="/styles.css"/>
${head}
</head><body>
<nav class="nav"><div class="wrap nav-in">
  <a class="brand" href="/index.html">${brandSvg("#0E1733")}<span>The Career Architect</span></a>
  <div class="nav-links">
    <a href="/index.html">Home</a><a href="/jobs.html" class="active">Jobs</a>
    <a href="/pricing.html">Pricing</a><a href="/seeker.html">My account</a>
    <a class="btn btn-ghost" href="/agent.html">For recruiters</a>
  </div>
</div></nav>
${body}
<footer style="background:var(--ink);color:var(--paper-2);margin-top:4rem"><div class="wrap" style="padding:2.4rem 0;display:flex;justify-content:space-between;flex-wrap:wrap;gap:1rem;align-items:center">
  <a class="brand" href="/index.html" style="color:var(--paper)">${brandSvg("#1C2748")}<span>The Career Architect</span></a>
  <small>© ${new Date().getFullYear()} The Career Architect</small>
</div></footer>
<script defer src="/_vercel/insights/script.js"></script>
</body></html>`;
}

function notFound(res) {
  res.status(404).send(
    shell(
      "Job not found - The Career Architect",
      "This role is no longer available.",
      `${SITE}/jobs.html`,
      "",
      `<main class="wrap" style="padding:5rem 0;text-align:center">
        <h1 style="font-size:1.8rem">This role is no longer available</h1>
        <p style="color:var(--slate);margin:1rem 0 2rem">It may have been filled or closed. Browse current openings instead.</p>
        <a class="btn btn-accent" href="/jobs.html">Browse all jobs</a>
      </main>`
    )
  );
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const id = (req.query.id || "").toString();
  let job = null;
  try {
    const sb = getServiceClient();
    if (sb && id) {
      const { data } = await sb.from("jobs").select("*").eq("id", id).eq("status", "published").maybeSingle();
      job = data;
    }
  } catch (e) {
    console.error("job lookup failed:", e);
  }
  if (!job) return notFound(res);

  const canonical = `${SITE}/job/${job.id}`;
  const remote = String(job.work_mode || "").toLowerCase().includes("remote");
  const posted = new Date(job.created_at);
  const validThrough = new Date(posted.getTime() + 60 * 864e5).toISOString().slice(0, 10);
  const salaryStr =
    job.salary_min || job.salary_max
      ? `${job.salary_currency || "USD"} ${(job.salary_min || job.salary_max).toLocaleString()}${job.salary_max && job.salary_min ? "-" + job.salary_max.toLocaleString() : ""}/yr`
      : "";

  // ----- JobPosting structured data -----
  const ld = {
    "@context": "https://schema.org/",
    "@type": "JobPosting",
    title: job.title,
    description: `<p>${esc(job.description).replace(/\n+/g, "<br>")}</p>`,
    datePosted: posted.toISOString().slice(0, 10),
    validThrough,
    hiringOrganization: { "@type": "Organization", name: job.company, sameAs: SITE },
    identifier: { "@type": "PropertyValue", name: job.company, value: String(job.id) },
  };
  const et = EMP_TYPE[String(job.employment_type || "").toLowerCase().replace(/\s+/g, "-")] || EMP_TYPE[String(job.employment_type || "").toLowerCase()];
  if (et) ld.employmentType = et;
  if (remote) {
    ld.jobLocationType = "TELECOMMUTE";
    ld.applicantLocationRequirements = [
      { "@type": "Country", name: "USA" },
      { "@type": "Country", name: "Canada" },
    ];
  } else if (job.location) {
    ld.jobLocation = { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: job.location, addressCountry: "US" } };
  }
  if (job.salary_min || job.salary_max) {
    ld.baseSalary = {
      "@type": "MonetaryAmount",
      currency: job.salary_currency || "USD",
      value: { "@type": "QuantitativeValue", minValue: job.salary_min || job.salary_max, maxValue: job.salary_max || job.salary_min, unitText: "YEAR" },
    };
  }

  const metaDesc = `${job.title} at ${job.company}${remote ? " (Remote)" : job.location ? " - " + job.location : ""}. ${String(job.description || "").slice(0, 120)}`;
  const head = `<script type="application/ld+json">${JSON.stringify(ld)}</script>`;

  const chips = [
    remote ? "Remote" : job.work_mode,
    job.employment_type,
    job.category,
    job.experience,
    salaryStr,
  ].filter(Boolean);

  const cleanApply = safeUrl(job.apply_url);
  const applyHref = cleanApply || `/jobs.html`;
  const applyTarget = cleanApply ? ` target="_blank" rel="noopener nofollow"` : "";

  const body = `<main class="wrap" style="padding:2.5rem 0 1rem;max-width:820px">
    <a href="/jobs.html" style="color:var(--slate);font-size:.9rem">← All jobs</a>
    <h1 style="font-size:2rem;margin:1rem 0 .4rem">${esc(job.title)}</h1>
    <p style="font-size:1.1rem;color:var(--ink);font-weight:600">${esc(job.company)}${job.location ? ` · ${esc(job.location)}` : ""}</p>
    <div style="display:flex;flex-wrap:wrap;gap:.5rem;margin:1.1rem 0">
      ${chips.map((c) => `<span style="background:var(--paper-2);border:1px solid var(--line);border-radius:999px;padding:.3rem .8rem;font-size:.82rem;color:var(--slate)">${esc(c)}</span>`).join("")}
      ${job.visa_sponsorship ? `<strong style="background:#fff0f1;border:1px solid #bd2435;border-radius:999px;padding:.3rem .8rem;font-size:.82rem;color:#a31529;font-weight:800">VISA SPONSORSHIP OFFERED</strong>` : ""}
    </div>
    <a class="btn btn-accent" href="${esc(applyHref)}"${applyTarget} style="margin:.4rem 0 2rem">Apply now</a>
    <article style="white-space:pre-wrap;line-height:1.7;color:var(--ink-2)">${esc(job.description)}</article>
    <div style="margin:2.5rem 0;padding:1.5rem;background:var(--paper-2);border-radius:var(--r)">
      <h2 style="font-size:1.1rem;margin-bottom:.5rem">Ready to apply?</h2>
      <p style="color:var(--slate);margin-bottom:1rem">Tailor your resume to this role with AI before you apply, and increase your match score.</p>
      <a class="btn btn-ink" href="/jobs.html">Tailor my resume</a>
    </div>
  </main>`;

  res.setHeader("Cache-Control", "public, max-age=600, s-maxage=600");
  res.status(200).send(shell(`${job.title} at ${job.company} - The Career Architect`, metaDesc, canonical, head, body));
}

import { careerBySlug, CAREERS } from "../lib/careers-data.js";

// Server-rendered SEO career guide at /career/:slug.
const SITE = "https://thecareerarchitect.org";
const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => "$" + Number(n).toLocaleString();

function brandSvg(fill) {
  return `<svg width="24" height="24" viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="9" fill="${fill}"/><path d="M11 30 L20 11 L29 30" fill="none" stroke="#27C285" stroke-width="3.4" stroke-linejoin="round" stroke-linecap="round"/><line x1="15" y1="23.5" x2="25" y2="23.5" stroke="#27C285" stroke-width="3" stroke-linecap="round"/><circle cx="20" cy="10" r="2.4" fill="#D99A28"/></svg>`;
}

function chips(items) {
  return `<div style="display:flex;flex-wrap:wrap;gap:.5rem;margin:.6rem 0 1.4rem">${items
    .map((i) => `<span style="background:var(--paper-2);border:1px solid var(--line);border-radius:999px;padding:.3rem .8rem;font-size:.85rem">${esc(i)}</span>`)
    .join("")}</div>`;
}

export default function handler(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const slug = (req.query.slug || "").toString();
  const c = careerBySlug(slug);

  if (!c) {
    res.status(404).send(shell("Guide not found - The Career Architect", "This career guide doesn't exist.", `${SITE}/careers.html`, "",
      `<main class="wrap" style="padding:5rem 0;text-align:center"><h1>Guide not found</h1><p style="color:var(--slate);margin:1rem 0 2rem">Browse all career guides instead.</p><a class="btn btn-accent" href="/careers.html">All career guides</a></main>`));
    return;
  }

  const canonical = `${SITE}/career/${c.slug}`;
  const title = `${c.role} Career Guide: Salary, Skills & How to Become One (Remote) | The Career Architect`;
  const desc = `${c.role} remote career guide: salary (${money(c.salaryLow)}-${money(c.salaryHigh)}), key skills, certifications, and how to become one in the US & Canada.`;

  const related = CAREERS.filter((x) => x.slug !== c.slug && x.category === c.category).slice(0, 3);

  const ld = [
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: c.faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE}/` },
      { "@type": "ListItem", position: 2, name: "Career guides", item: `${SITE}/careers.html` },
      { "@type": "ListItem", position: 3, name: c.role, item: canonical },
    ] },
  ];
  const head = ld.map((x) => `<script type="application/ld+json">${JSON.stringify(x)}</script>`).join("");

  const body = `<main class="wrap" style="max-width:820px;padding:2.5rem 0">
    <a href="/careers.html" style="color:var(--slate);font-size:.9rem">← All career guides</a>
    <span class="eyebrow" style="margin-top:1rem">${esc(c.category)} career</span>
    <h1 style="font-size:2.3rem;margin:.8rem 0 .6rem">${esc(c.role)}: Salary, Skills &amp; How to Become One</h1>
    <p style="font-size:1.12rem;color:var(--ink-2);line-height:1.7">${esc(c.summary)}</p>

    <div style="display:flex;gap:1rem;flex-wrap:wrap;margin:1.6rem 0">
      <div style="flex:1;min-width:180px;background:var(--white);border:1px solid var(--line);border-radius:var(--r);padding:1.2rem">
        <div style="font-size:.8rem;color:var(--slate);font-family:'Space Mono',monospace;text-transform:uppercase;letter-spacing:.1em">Remote salary (US/CA)</div>
        <div style="font-size:1.5rem;font-weight:700;font-family:'Space Grotesk';color:var(--emerald);margin-top:.3rem">${money(c.salaryLow)} - ${money(c.salaryHigh)}</div>
      </div>
      <div style="flex:1;min-width:180px;background:var(--ink);color:var(--paper);border-radius:var(--r);padding:1.2rem;display:flex;flex-direction:column;justify-content:center">
        <div style="margin-bottom:.6rem;font-size:.95rem">See your path into this role with AI</div>
        <a class="btn btn-accent" href="/career-path.html" style="align-self:flex-start">Map my path</a>
      </div>
    </div>

    <h2 style="font-size:1.4rem;margin:2rem 0 .3rem">Key skills</h2>
    ${chips(c.skills)}

    <h2 style="font-size:1.4rem;margin:1.5rem 0 .3rem">Certifications that help</h2>
    ${chips(c.certs)}

    <h2 style="font-size:1.4rem;margin:1.5rem 0 .6rem">How to become a ${esc(c.role)}</h2>
    <ol style="line-height:1.9;color:var(--ink-2);padding-left:1.2rem">${c.howTo.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>

    <h2 style="font-size:1.4rem;margin:1.8rem 0 .6rem">Career path</h2>
    <p style="color:var(--ink-2);line-height:1.7">Many people reach this role from ${c.pathFrom.map(esc).join(" or ")}, and grow into ${c.pathTo.map(esc).join(" or ")}.</p>

    <div style="background:var(--paper-2);border-radius:var(--r);padding:1.5rem;margin:1.8rem 0">
      <h2 style="font-size:1.15rem;margin-bottom:.5rem">Ready to land a ${esc(c.role)} role?</h2>
      <p style="color:var(--slate);margin-bottom:1rem">Tailor your résumé to the job, prep for interviews, and find remote openings - all with AI.</p>
      <div style="display:flex;gap:.7rem;flex-wrap:wrap"><a class="btn btn-accent" href="/jobs.html">Find remote jobs</a><a class="btn btn-ghost" href="/tools.html">See all tools</a></div>
    </div>

    <h2 style="font-size:1.4rem;margin:2rem 0 1rem">${esc(c.role)} FAQ</h2>
    ${c.faqs.map((f) => `<details style="border:1px solid var(--line);border-radius:var(--r);padding:1rem 1.2rem;margin-bottom:.7rem;background:var(--white)"><summary style="font-weight:600;cursor:pointer;font-family:'Space Grotesk'">${esc(f.q)}</summary><p style="color:var(--slate);margin-top:.7rem;line-height:1.7">${esc(f.a)}</p></details>`).join("")}

    ${related.length ? `<h2 style="font-size:1.4rem;margin:2.2rem 0 .8rem">Related guides</h2><div style="display:flex;flex-wrap:wrap;gap:.6rem">${related.map((r) => `<a href="/career/${r.slug}" style="background:var(--white);border:1px solid var(--line);border-radius:999px;padding:.4rem .9rem;font-size:.9rem;color:var(--emerald)">${esc(r.role)} →</a>`).join("")}</div>` : ""}
  </main>`;

  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600");
  res.status(200).send(shell(title, desc, canonical, head, body));
}

function shell(title, desc, canonical, head, body) {
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}"/>
<link rel="canonical" href="${canonical}"/>
<meta property="og:type" content="article"/><meta property="og:title" content="${esc(title)}"/>
<meta property="og:description" content="${esc(desc)}"/><meta property="og:url" content="${canonical}"/>
<meta name="theme-color" content="#0E1733"/>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Crect width='40' height='40' rx='9' fill='%230E1733'/%3E%3Cpath d='M11 30 L20 11 L29 30' fill='none' stroke='%2327C285' stroke-width='3.4' stroke-linejoin='round' stroke-linecap='round'/%3E%3Cline x1='15' y1='23.5' x2='25' y2='23.5' stroke='%2327C285' stroke-width='3' stroke-linecap='round'/%3E%3Ccircle cx='20' cy='10' r='2.4' fill='%23D99A28'/%3E%3C/svg%3E"/>
<link rel="preconnect" href="https://fonts.googleapis.com"/><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet"/>
<link rel="stylesheet" href="/styles.css"/>
${head}
</head><body>
<nav class="nav"><div class="wrap nav-in">
  <a class="brand" href="/index.html">${brandSvg("#0E1733")}<span>The Career Architect</span></a>
  <div class="nav-links"><a href="/index.html">Home</a><a href="/tools.html">Tools</a><a href="/careers.html" class="active">Guides</a><a href="/jobs.html">Jobs</a><a href="/pricing.html">Pricing</a></div>
</div></nav>
${body}
<footer style="background:var(--ink);color:var(--paper-2);margin-top:3rem"><div class="wrap" style="padding:2.2rem 0;display:flex;justify-content:space-between;flex-wrap:wrap;gap:1rem;align-items:center">
  <a class="brand" href="/index.html" style="color:var(--paper)">${brandSvg("#1C2748")}<span>The Career Architect</span></a>
  <div style="display:flex;gap:1.2rem;font-size:.9rem;flex-wrap:wrap"><a href="/terms.html">Terms</a><a href="/privacy.html">Privacy</a><a href="/refund.html">Refunds</a></div>
  <small>© ${new Date().getFullYear()} The Career Architect</small>
</div></footer>
<script defer src="/_vercel/insights/script.js"></script>
</body></html>`;
}

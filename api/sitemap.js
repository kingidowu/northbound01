import { getServiceClient } from "../lib/knowledge.js";
import { CAREERS } from "../lib/careers-data.js";

// Dynamic sitemap: static pages + SEO landing pages + every published job
// (so Google can discover the /job/:id pages that carry JobPosting data).
const SITE = "https://thecareerarchitect.org";
const STATIC = [
  { loc: "/", pr: "1.0", freq: "weekly" },
  { loc: "/jobs.html", pr: "0.9", freq: "daily" },
  { loc: "/tools.html", pr: "0.8", freq: "monthly" },
  { loc: "/careers.html", pr: "0.8", freq: "weekly" },
  { loc: "/career-path.html", pr: "0.8", freq: "monthly" },
  { loc: "/salary.html", pr: "0.8", freq: "monthly" },
  { loc: "/linkedin.html", pr: "0.8", freq: "monthly" },
  { loc: "/remote-it-jobs.html", pr: "0.8", freq: "weekly" },
  { loc: "/remote-cloud-jobs.html", pr: "0.8", freq: "weekly" },
  { loc: "/remote-healthcare-tech-jobs.html", pr: "0.8", freq: "weekly" },
  { loc: "/pricing.html", pr: "0.7", freq: "monthly" },
  { loc: "/ats.html", pr: "0.7", freq: "monthly" },
  { loc: "/interview.html", pr: "0.6", freq: "monthly" },
  { loc: "/agent.html", pr: "0.6", freq: "monthly" },
];

export default async function handler(req, res) {
  let jobs = [];
  try {
    const sb = getServiceClient();
    if (sb) {
      const { data } = await sb
        .from("jobs")
        .select("id, created_at")
        .eq("status", "published")
        .order("created_at", { ascending: false })
        .limit(2000);
      jobs = data || [];
    }
  } catch (e) {
    console.error("sitemap jobs lookup failed:", e);
  }

  const urls = [
    ...STATIC.map(
      (s) => `<url><loc>${SITE}${s.loc}</loc><changefreq>${s.freq}</changefreq><priority>${s.pr}</priority></url>`
    ),
    ...CAREERS.map(
      (c) => `<url><loc>${SITE}/career/${c.slug}</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>`
    ),
    ...jobs.map((j) => {
      const d = new Date(j.created_at).toISOString().slice(0, 10);
      return `<url><loc>${SITE}/job/${j.id}</loc><lastmod>${d}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>`;
    }),
  ].join("");

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600");
  res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
}

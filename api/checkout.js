import { rateLimit } from "../lib/ratelimit.js";

// Creates a Stripe Checkout session (no Stripe SDK needed - raw REST).
// Needs STRIPE_SECRET_KEY (server-side env var). Uses inline price_data so you
// don't have to pre-create products in Stripe.
const SITE = "https://thecareerarchitect.org";
const PLANS = {
  pro_monthly:      { name: "Pro - monthly",            amount: 1900,  mode: "subscription", interval: "month" },
  pro_annual:       { name: "Pro - annual",             amount: 19000, mode: "subscription", interval: "year" },
  coaching_monthly: { name: "Coaching - monthly",       amount: 9900,  mode: "subscription", interval: "month" },
  coaching_annual:  { name: "Coaching - annual",        amount: 99000, mode: "subscription", interval: "year" },
  pack_resume:      { name: "Resume revamp",            amount: 4900,  mode: "payment" },
  pack_strategy:    { name: "Career strategy session",  amount: 9900,  mode: "payment" },
  pack_mock:        { name: "Mock interview",           amount: 5900,  mode: "payment" },
  employer:         { name: "Employer Pro - monthly",   amount: 4900,  mode: "subscription", interval: "month" },
};

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) { res.status(503).json({ error: "Online billing isn't switched on yet." }); return; }
  const rl = await rateLimit(req, { limit: 15, windowMs: 60_000 });
  if (!rl.ok) { res.setHeader("Retry-After", rl.retryAfter); res.status(429).json({ error: "Too many requests." }); return; }

  try {
    const b = req.body && typeof req.body === "object" ? req.body : {};
    const plan = PLANS[(b.plan || "").toString()];
    if (!plan) { res.status(400).json({ error: "Unknown plan" }); return; }
    const email = (b.email || "").toString().slice(0, 200).trim();

    const p = new URLSearchParams();
    p.set("mode", plan.mode);
    p.set("success_url", `${SITE}/pricing.html?success=1`);
    p.set("cancel_url", `${SITE}/pricing.html?canceled=1`);
    p.set("allow_promotion_codes", "true");
    p.append("line_items[0][quantity]", "1");
    p.append("line_items[0][price_data][currency]", "usd");
    p.append("line_items[0][price_data][product_data][name]", plan.name);
    p.append("line_items[0][price_data][unit_amount]", String(plan.amount));
    if (plan.mode === "subscription") p.append("line_items[0][price_data][recurring][interval]", plan.interval);
    if (email) p.set("customer_email", email);
    p.set("metadata[plan]", b.plan);

    const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: p,
    });
    const s = await r.json();
    if (!r.ok) throw new Error(s.error?.message || "Stripe error");
    res.status(200).json({ url: s.url });
  } catch (e) {
    console.error("checkout failed:", e);
    res.status(502).json({ error: e.message || "Checkout failed" });
  }
}

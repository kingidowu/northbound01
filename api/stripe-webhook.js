import crypto from "crypto";
import { getServiceClient } from "../lib/knowledge.js";

// Stripe sends raw JSON we must verify byte-for-byte — disable body parsing.
export const config = { api: { bodyParser: false } };

const FROM = process.env.FROM_EMAIL || "The Career Architect <admin@thecareerarchitect.org>";

async function rawBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === "string" ? Buffer.from(c) : c);
  return Buffer.concat(chunks);
}

// Verify Stripe's signature header without the Stripe SDK.
function verify(raw, sigHeader, secret) {
  const parts = Object.fromEntries((sigHeader || "").split(",").map((p) => p.split("=")));
  if (!parts.t || !parts.v1) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${parts.t}.${raw.toString("utf8")}`).digest("hex");
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1)); } catch { return false; }
}

async function sendReceipt(to, plan, amount, currency) {
  if (!process.env.RESEND_API_KEY || !to) return;
  const html = `<div style="font-family:Inter,Arial,sans-serif;color:#0E1733;max-width:520px;margin:auto">
    <b style="font-family:'Space Grotesk'">The Career Architect</b>
    <p>Thanks for your purchase! Here's your receipt.</p>
    <p><b>${plan || "Plan"}</b><br>${currency} ${amount.toFixed(2)}</p>
    <p>Your access is active. Head to <a href="https://thecareerarchitect.org" style="color:#16895B">the platform</a> to get started.</p>
  </div>`;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to, subject: "Your receipt — The Career Architect", html }),
  }).catch(() => {});
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).end(); return; }
  const raw = await rawBody(req);
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (secret) {
    if (!verify(raw, req.headers["stripe-signature"], secret)) { res.status(400).json({ error: "invalid signature" }); return; }
  }

  let event;
  try { event = JSON.parse(raw.toString("utf8")); } catch { res.status(400).end(); return; }

  try {
    if (event.type === "checkout.session.completed") {
      const s = event.data.object;
      const email = s.customer_details?.email || s.customer_email || null;
      const plan = s.metadata?.plan || "";
      const amount = (s.amount_total || 0) / 100;
      const currency = (s.currency || "usd").toUpperCase();

      const userId = s.client_reference_id || s.metadata?.user_id || null;
      const tier = plan.startsWith("pro") ? "pro" : plan.startsWith("coaching") ? "coaching" : null;

      const sb = getServiceClient();
      if (sb) {
        await sb.from("purchases").upsert(
          { email, plan, amount, currency, stripe_session_id: s.id, status: s.payment_status || "paid" },
          { onConflict: "stripe_session_id" }
        ).then(() => {}, (e) => console.error("purchase insert:", e));

        // Unlock membership for subscription plans tied to a logged-in account.
        if (userId && tier) {
          await sb.from("memberships").upsert(
            { user_id: userId, email, plan: tier, status: "active", stripe_customer_id: s.customer || null, updated_at: new Date().toISOString() },
            { onConflict: "user_id" }
          ).then(() => {}, (e) => console.error("membership upsert:", e));
        }
      }
      await sendReceipt(email, plan, amount, currency);
    }
    res.status(200).json({ received: true });
  } catch (e) {
    console.error("webhook handler error:", e);
    res.status(200).json({ received: true }); // ack so Stripe doesn't retry-storm
  }
}

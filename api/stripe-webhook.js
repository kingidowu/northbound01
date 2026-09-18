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
export function verify(raw, sigHeader, secret) {
  const parts=(sigHeader||"").split(",").map(part=>part.trim().split("="));
  const timestamp=parts.find(([key])=>key==="t")?.[1];
  const signatures=parts.filter(([key])=>key==="v1").map(([,value])=>value);
  if(!/^\d+$/.test(timestamp||"")||Math.abs(Date.now()/1000-Number(timestamp))>300||!signatures.length)return false;
  const expected=crypto.createHmac("sha256",secret).update(`${timestamp}.${raw.toString("utf8")}`).digest("hex");
  return signatures.some(signature=>/^[a-f0-9]{64}$/i.test(signature)&&crypto.timingSafeEqual(Buffer.from(expected,"hex"),Buffer.from(signature,"hex")));
}

async function sendReceipt(to, plan, amount, currency, eventId) {
  if (!process.env.RESEND_API_KEY || !to) return;
  const html = `<div style="font-family:Inter,Arial,sans-serif;color:#0E1733;max-width:520px;margin:auto">
    <b style="font-family:'Space Grotesk'">The Career Architect</b>
    <p>Thanks for your purchase! Here's your receipt.</p>
    <p><b>${plan || "Plan"}</b><br>${currency} ${amount.toFixed(2)}</p>
    <p>Your access is active. Head to <a href="https://thecareerarchitect.org" style="color:#16895B">the platform</a> to get started.</p>
  </div>`;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key":`stripe-receipt-${eventId}` },
    body: JSON.stringify({ from: FROM, to, subject: "Your receipt — The Career Architect", html }),
  }).catch(() => {});
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).end(); return; }
  const raw = await rawBody(req);
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) { res.status(503).json({ error: "webhook secret missing" }); return; }
  if (!verify(raw, req.headers["stripe-signature"], secret)) { res.status(400).json({ error: "invalid signature" }); return; }

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
        const {error:purchaseError}=await sb.from("purchases").upsert(
          { email, plan, amount, currency, stripe_session_id: s.id, status: s.payment_status || "paid" },
          { onConflict: "stripe_session_id" }
        );
        if(purchaseError)throw purchaseError;

        // Unlock membership for subscription plans tied to a logged-in account.
        if (userId && tier) {
          const {error:membershipError}=await sb.from("memberships").upsert(
            { user_id: userId, email, plan: tier, status: "active", stripe_customer_id: s.customer || null, updated_at: new Date().toISOString() },
            { onConflict: "user_id" }
          );
          if(membershipError)throw membershipError;
        }
      }
      await sendReceipt(email, plan, amount, currency,event.id);
    }
    if(event.type==="customer.subscription.updated"||event.type==="customer.subscription.deleted"){
      const subscription=event.data.object;
      const sb=getServiceClient();
      if(sb&&subscription.customer){
        const status=event.type==="customer.subscription.deleted"?"canceled":subscription.status;
        const period=subscription.current_period_end?new Date(subscription.current_period_end*1000).toISOString():null;
        const {error}=await sb.from("memberships").update({status,current_period_end:period,updated_at:new Date().toISOString()}).eq("stripe_customer_id",subscription.customer);
        if(error)throw error;
      }
    }
    res.status(200).json({ received: true });
  } catch (e) {
    console.error("webhook handler error:", e);
    res.status(500).json({ error: "Webhook processing failed" });
  }
}

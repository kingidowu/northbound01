import { getServiceClient } from "../lib/knowledge.js";

// Admin-only: invite (or promote) another user to admin. The caller must already
// be an admin. Creates the user via Supabase Admin API (emails them an invite to
// set a password) and grants admin, or promotes an existing account.
const SITE = "https://thecareerarchitect.org";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  const sb = getServiceClient();
  if (!sb) { res.status(503).json({ error: "Not configured." }); return; }

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) { res.status(401).json({ error: "Sign in as admin." }); return; }

  // Verify the caller is an admin.
  const { data: u } = await sb.auth.getUser(token);
  if (!u?.user) { res.status(401).json({ error: "Invalid session." }); return; }
  const { data: adminRow } = await sb.from("admins").select("id").eq("id", u.user.id).maybeSingle();
  if (!adminRow) { res.status(403).json({ error: "Admins only." }); return; }

  const email = (req.body?.email || "").toString().trim().toLowerCase();
  if (!email || !email.includes("@")) { res.status(400).json({ error: "Enter a valid email." }); return; }

  try {
    let targetId = null;
    let invited = false;
    const { data: inv, error: invErr } = await sb.auth.admin.inviteUserByEmail(email, { redirectTo: `${SITE}/reset.html` });
    if (invErr) {
      // Already registered -> find and promote them instead.
      const { data: list } = await sb.auth.admin.listUsers();
      const found = list?.users?.find((x) => (x.email || "").toLowerCase() === email);
      if (!found) throw invErr;
      targetId = found.id;
    } else {
      targetId = inv?.user?.id;
      invited = true;
    }
    if (!targetId) { res.status(502).json({ error: "Couldn't create or find that user." }); return; }

    await sb.from("admins").upsert({ id: targetId }, { onConflict: "id" });
    res.status(200).json({ ok: true, email, invited });
  } catch (e) {
    console.error("invite-admin failed:", e);
    res.status(502).json({ error: e.message || "Invite failed." });
  }
}

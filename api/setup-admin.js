import { createClient } from "@supabase/supabase-js";

// ONE-TIME admin bootstrap. Protected by SETUP_SECRET (server-only env var).
// Creates/updates the Supabase user and grants admin. This file is REMOVED
// right after use so it can't be called again.
export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  const b = req.body && typeof req.body === "object" ? req.body : {};
  if (!process.env.SETUP_SECRET || b.secret !== process.env.SETUP_SECRET) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { res.status(500).json({ error: "Supabase not configured" }); return; }
  const email = (b.email || "").toString().trim();
  const password = (b.password || "").toString();
  if (!email || password.length < 6) { res.status(400).json({ error: "email + 6+ char password required" }); return; }

  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    let userId;
    const { data: created, error: cErr } = await sb.auth.admin.createUser({ email, password, email_confirm: true });
    if (cErr || !created?.user) {
      // Probably already exists — find and update the password.
      const { data: list } = await sb.auth.admin.listUsers({ perPage: 1000 });
      const u = list?.users?.find((x) => x.email === email);
      if (!u) throw (cErr || new Error("could not create or find user"));
      userId = u.id;
      await sb.auth.admin.updateUserById(userId, { password, email_confirm: true });
    } else {
      userId = created.user.id;
    }
    await sb.from("admins").upsert({ id: userId });
    res.status(200).json({ ok: true, email, userId });
  } catch (e) {
    console.error("setup-admin failed:", e);
    res.status(500).json({ error: e.message });
  }
}

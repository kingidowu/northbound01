import { getServiceClient } from "./knowledge.js";

// Free monthly allowance per AI feature. Pro/Coaching members are unlimited.
const FREE_LIMITS = { tailor: 3, interview: 3, rewrite: 3, salary: 3, linkedin: 3, career: 3 };

// Decide whether this request may run a paid AI feature.
// Returns { allowed, ... }. When allowed and the user is on the free tier, the
// caller must invoke recordUse(result) after a successful generation.
export async function gate(req, feature) {
  const sb = getServiceClient();
  if (!sb) return { allowed: true, sb: null }; // DB not configured -> don't block anyone

  const auth = req.headers.authorization || req.headers.Authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return { allowed: false, status: 401, error: "Create a free account to use this tool.", signIn: true };

  let user = null;
  try { const r = await sb.auth.getUser(token); user = r.data?.user || null; } catch { user = null; }
  if (!user) return { allowed: false, status: 401, error: "Please sign in again.", signIn: true };

  const { data: m } = await sb.from("memberships").select("plan,status").eq("user_id", user.id).maybeSingle();
  if (m && m.status === "active" && (m.plan === "pro" || m.plan === "coaching")) {
    return { allowed: true, sb, user, plan: m.plan, unlimited: true };
  }

  const month = new Date().toISOString().slice(0, 7); // YYYY-MM
  const limit = FREE_LIMITS[feature] || 3;
  const { data: u } = await sb
    .from("ai_usage")
    .select("count")
    .eq("user_id", user.id).eq("month", month).eq("feature", feature)
    .maybeSingle();
  const used = u?.count || 0;
  if (used >= limit) {
    return { allowed: false, status: 402, upgrade: true, used, limit,
      error: `You've used all ${limit} free ${feature} credits this month. Upgrade to Pro for unlimited.` };
  }
  return { allowed: true, sb, user, plan: "free", month, feature, used, limit };
}

// Increment the monthly counter after a successful free-tier generation.
export async function recordUse(g) {
  if (!g || !g.sb || !g.user || g.unlimited) return;
  try {
    await g.sb.from("ai_usage").upsert(
      { user_id: g.user.id, month: g.month, feature: g.feature, count: (g.used || 0) + 1 },
      { onConflict: "user_id,month,feature" }
    );
  } catch (e) {
    console.error("ai_usage increment failed:", e);
  }
}

import { accessLevel } from "./entitlement.js";

export async function assessmentAccess(sb, authorization, submittedEmail) {
  const header = String(authorization || "");
  if (!header) return { paid: false, userId: null, plan: "free" };
  const token = /^Bearer\s+(.+)$/i.exec(header)?.[1];
  if (!token) return { error: "Please sign in again.", status: 401 };
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) return { error: "Please sign in again.", status: 401 };
  const user = data.user;
  const level = await accessLevel(sb, user.id);
  const paid = level.unlimited;
  if (paid && String(user.email || "").trim().toLowerCase() !== String(submittedEmail || "").trim().toLowerCase()) {
    return { error: "Use your signed-in account email to receive the Pro PDF package.", status: 400 };
  }
  return { paid, userId: user.id, plan: level.plan };
}

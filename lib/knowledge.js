// =========================================================
// The Career Architect — AI knowledge library
// Same idea as the sourceflow knowledge library: Claude EXTRACTS structured
// knowledge from each document, we STORE it, and we RETRIEVE recent entries to
// feed back as context. No vector DB — the model does the extraction + synthesis.
// The more resumes/assessments flow in, the richer the context the AI gets.
//
// Writes use the Supabase SERVICE ROLE key (server-side only, bypasses RLS).
// Everything here degrades gracefully: if the service key isn't set, the core
// AI features still work — they just don't read/write the library.
// =========================================================
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

// Service-role client — server-only. Returns null if not configured.
export function getServiceClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "2-3 sentence plain summary of this person's profile and what they're after." },
    field: { type: "string", description: "Primary field/industry, e.g. IT, Healthcare, Cloud computing." },
    seniority: { type: "string", description: "Entry | Mid | Senior | Lead | Unknown." },
    skills: { type: "array", items: { type: "string" }, description: "Concrete skills/tools." },
    target_roles: { type: "array", items: { type: "string" }, description: "Roles they fit or want." },
    common_gaps: { type: "array", items: { type: "string" }, description: "Weaknesses or missing elements worth noting." },
    keywords: { type: "array", items: { type: "string" }, description: "Searchable keywords." },
    tags: { type: "array", items: { type: "string" }, description: "5-8 short descriptive tags; first tag is the field." },
  },
  required: ["summary", "field", "seniority", "skills", "target_roles", "common_gaps", "keywords", "tags"],
  additionalProperties: false,
};

// Extract structured knowledge from raw text (resume or assessment).
// `input` is either a plain string (text) or an array of Claude content blocks
// (used for PDF documents and images, which Claude reads natively).
export async function extractKnowledge(input) {
  const content = typeof input === "string"
    ? `Extract structured career knowledge from this submission:\n\n${input.slice(0, 16000)}`
    : input;
  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5", // cheap + fast for extraction (no effort param - unsupported on Haiku)
    max_tokens: 1200,
    output_config: { format: { type: "json_schema", schema: EXTRACT_SCHEMA } },
    system: "You extract reusable, structured career knowledge from a resume or career-assessment submission (which may be plain text, a PDF, or an image), for a careers platform focused on IT, healthcare, and cloud computing across the US and Canada. Read the document/image carefully and be precise and factual.",
    messages: [{ role: "user", content }],
  });
  const t = msg.content.find((b) => b.type === "text")?.text || "{}";
  return JSON.parse(t);
}

export async function saveKnowledge(sb, { source_type, title, summary, extraction, tags }) {
  if (!sb) return;
  try {
    await sb.from("knowledge_library").insert({ source_type, title, summary, extraction, tags });
  } catch (e) { console.error("saveKnowledge failed:", e); }
}

// Pull recent library entries to feed back as accumulated context.
export async function retrieveContext(sb, limit = 6) {
  if (!sb) return "";
  try {
    const { data } = await sb
      .from("knowledge_library")
      .select("summary, extraction")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (!data || !data.length) return "";
    const lines = data.map((r, i) => {
      const e = r.extraction || {};
      return `(${i + 1}) ${e.field || "?"} / ${e.seniority || "?"} — ${r.summary || ""}${e.common_gaps?.length ? " Gaps seen: " + e.common_gaps.join(", ") : ""}`;
    });
    return `\n\nPatterns learned from ${data.length} recent submissions on this platform (use as background, do not quote individuals):\n${lines.join("\n")}`;
  } catch (e) { console.error("retrieveContext failed:", e); return ""; }
}

// Convenience: extract + save in the background (never throws).
// `input` may be a string (text) or an array of Claude content blocks (file).
export async function ingest(sb, source_type, title, input) {
  try {
    const extraction = await extractKnowledge(input);
    await saveKnowledge(sb, {
      source_type, title,
      summary: extraction.summary,
      extraction,
      tags: extraction.tags || [],
    });
    return extraction;
  } catch (e) { console.error("ingest failed:", e); return null; }
}

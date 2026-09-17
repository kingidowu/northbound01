import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const SCHEMA = {
  type: "object",
  properties: {
    ats_score: { type: "integer", description: "0-100 estimate of ATS readiness. If a job description is provided, score fit for that specific job." },
    verdict: { type: "string", description: "One-sentence assessment grounded in the resume." },
    strengths: { type: "array", items: { type: "string" }, description: "Evidence-backed strengths (3-5)." },
    gaps: { type: "array", items: { type: "string" }, description: "Missing or weak areas (3-6)." },
    formatting_flags: { type: "array", items: { type: "string" }, description: "Only formatting problems observable from the supplied resume text or file; may be empty." },
    keywords_to_add: { type: "array", items: { type: "string" }, description: "Relevant keywords supported by the candidate's actual experience; may be empty." },
    rewrite_tips: { type: "array", items: { type: "string" }, description: "Specific resume changes (3-6)." },
    job_recommendations: {
      type: "array",
      description: "Four to six realistic job types, prioritizing jobs the candidate should apply to now. Include build-toward roles only when a concrete gap exists.",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "A searchable job title, not an employer or invented vacancy." },
          fit: { type: "string", enum: ["apply_now", "build_toward"] },
          reason: { type: "string", description: "Evidence from the resume and any meaningful limitation." },
          next_step: { type: "string", description: "What to highlight when applying, or the specific gap to close first." },
        },
        required: ["title", "fit", "reason", "next_step"],
        additionalProperties: false,
      },
    },
  },
  required: ["ats_score", "verdict", "strengths", "gaps", "formatting_flags", "keywords_to_add", "rewrite_tips", "job_recommendations"],
  additionalProperties: false,
};

const SYSTEM = `You are a resume reviewer and ATS specialist for The Career Architect.
Assess ATS readability and recruiter appeal using only the resume supplied. If a target job description is provided, score alignment to that job; otherwise score general ATS readiness. Do not imply the score is a measured hiring probability.
Recommend realistic job types based on demonstrated experience, skills, and seniority. Distinguish roles the candidate can apply to now from roles requiring development. Do not invent qualifications or job openings. Give concrete reasons and next steps. Be specific, honest, and constructive.`;

export async function analyzeResume(resumeInput, jobDescription = "", learnedContext = "") {
  const instruction = jobDescription
    ? `TARGET JOB DESCRIPTION:\n${jobDescription}\n\nScore ATS fit for this target job. Also recommend other realistic job types.`
    : "No target job was provided. Score general ATS readiness and recommend realistic job types.";
  const content = typeof resumeInput === "string"
    ? `RESUME:\n${resumeInput}\n\n${instruction}`
    : [...resumeInput, { type: "text", text: instruction }];
  const message = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 3000,
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM + learnedContext,
    messages: [{ role: "user", content }],
  });
  const result = JSON.parse(message.content.find((block) => block.type === "text")?.text || "{}");
  if (typeof result.ats_score === "number") {
    result.ats_score = Math.max(0, Math.min(100, Math.round(result.ats_score)));
  }
  return result;
}

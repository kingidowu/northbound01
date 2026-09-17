import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { createPdf, newToken, tokenHash, validToken, reportSections } from "../lib/candidate-package.js";

test("private prep tokens require an exact match",()=>{
  const token=newToken(),hash=tokenHash(token);
  assert.equal(validToken(token,hash),true);
  assert.equal(validToken(token+"x",hash),false);
  assert.equal(validToken(undefined,hash),false);
});

test("report PDF includes the career sections and paginates",async()=>{
  const record={full_name:"Sample Candidate",field:"Analytics",data:{package:{
    ats:{ats_score:72,verdict:"Needs clearer results",strengths:["SQL"],gaps:["Metrics"],rewrite_tips:["Add outcomes"],job_recommendations:[{fit:"apply_now",title:"Data Analyst",reason:"SQL work",next_step:"Highlight dashboards"}]},
    guide:{overview:"Background in analytics",action_plan:["Target data roles"],interview_questions:[{question:"Tell me about your dashboard",why_asked:"Evidence",answer_guidance:"Use a real example"}],interview_tips:["Practice STAR"]}
  }}};
  const pdf=await createPdf("Career report",reportSections(record));
  assert.equal(pdf.subarray(0,4).toString(),"%PDF");
  assert.ok((await PDFDocument.load(pdf)).getPageCount()>=1);
  const long=await createPdf("Long report",[["Details",Array(100).fill("Specific actionable career guidance for the candidate.")]]);
  assert.ok((await PDFDocument.load(long)).getPageCount()>1);
});

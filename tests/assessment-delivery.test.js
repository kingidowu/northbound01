import test from "node:test";
import assert from "node:assert/strict";
import { sendMaterials } from "../lib/assessment-delivery.js";

const record={id:"12345678-1234-1234-1234-123456789012",full_name:"Sample Candidate",email:"sample@example.com",field:"Analytics",data:{
  resume:"Experienced data analyst with SQL, dashboards, and quality checks.",
  package:{ats:{ats_score:70,verdict:"Ready for improvement",strengths:["SQL"],gaps:["Metrics"],rewrite_tips:["Add results"],job_recommendations:[{fit:"apply_now",title:"Data Analyst",reason:"SQL experience",next_step:"Highlight dashboards"}]},guide:{overview:"Analytics background",action_plan:["Apply to analyst roles"],tailored_resume:"Sample Candidate\nDATA ANALYST\nSQL dashboards and quality checks",resume_changes:["Clearer title"],interview_questions:[{question:"Tell me about your work",why_asked:"Evidence",answer_guidance:"Use a real example"}],interview_tips:["Practice specific examples"]}}
}};

test("candidate receives three PDF attachments and a private prep link",async()=>{
  const oldFetch=global.fetch,oldKey=process.env.RESEND_API_KEY,oldSecret=process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.RESEND_API_KEY="test-key";process.env.SUPABASE_SERVICE_ROLE_KEY="test-secret";
  const updates=[];let outbound;
  const sb={from:()=>({update:({data})=>({eq:async()=>{updates.push(data);return {error:null};}})})};
  global.fetch=async(_url,options)=>{outbound=options;return {ok:true,json:async()=>({id:"email-123"})};};
  try{
    const result=await sendMaterials(sb,record);
    assert.equal(result.ok,true);
    const email=JSON.parse(outbound.body);
    assert.deepEqual(email.attachments.map(a=>a.filename),["career-report.pdf","tailored-resume.pdf","interview-prep.pdf"]);
    for(const a of email.attachments)assert.equal(Buffer.from(a.content,"base64").subarray(0,4).toString(),"%PDF");
    assert.deepEqual(email.to,[record.email]);
    assert.match(email.html,/prep\.html\?id=/);
    assert.equal(updates.at(-1).delivery_status,"sent");
    assert.ok(updates.at(-1).delivery.token_hash);
    assert.equal(updates.at(-1).delivery.token_ciphertext,undefined);
  }finally{
    global.fetch=oldFetch;
    if(oldKey===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=oldKey;
    if(oldSecret===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldSecret;
  }
});

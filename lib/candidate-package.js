import Anthropic from "@anthropic-ai/sdk";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

const ai = new Anthropic();
const schema = {
  type:"object", properties:{
    overview:{type:"string"}, action_plan:{type:"array",items:{type:"string"}},
    tailored_resume:{type:"string"}, resume_changes:{type:"array",items:{type:"string"}},
    interview_questions:{type:"array",items:{type:"object",properties:{question:{type:"string"}, why_asked:{type:"string"}, answer_guidance:{type:"string"}},required:["question","why_asked","answer_guidance"],additionalProperties:false}},
    interview_tips:{type:"array",items:{type:"string"}}
  }, required:["overview","action_plan","tailored_resume","resume_changes","interview_questions","interview_tips"], additionalProperties:false
};
export async function generatePackage(intake, ats){
  const resume=String(intake.resume||"").slice(0,24000);
  const profile=Object.fromEntries(Object.entries(intake).filter(([k])=>!["resume","package","delivery"].includes(k)));
  const msg=await ai.messages.create({model:"claude-opus-4-8",max_tokens:5500,
    output_config:{effort:"medium",format:{type:"json_schema",schema}},
    system:"You are a careful career strategist, résumé writer and interview coach. Use only verified facts in the intake and résumé. Never invent employers, dates, metrics, degrees, certifications, or achievements. Tailor the résumé to realistic target roles, with clear ATS-friendly sections. Give a detailed, actionable career report and 6-8 interview questions with specific answer guidance; never present an invented answer as the candidate's own experience. ATS score is an estimate of document readiness, not a hiring probability. Avoid promises of job placement.",
    messages:[{role:"user",content:`INTAKE: ${JSON.stringify(profile)}\n\nORIGINAL RÉSUMÉ:\n${resume}\n\nATS REVIEW:\n${JSON.stringify(ats)}\n\nProduce a report, a complete tailored résumé, and interview preparation.`}]});
  return JSON.parse(msg.content.find(x=>x.type==="text")?.text||"{}");
}
export function newToken(){return randomBytes(32).toString("base64url");}
export function tokenHash(token){return createHash("sha256").update(token).digest("hex");}
export function validToken(token,hash){
  if(typeof token!=="string"||typeof hash!=="string"||token.length>100||!/^[a-f0-9]{64}$/.test(hash))return false;
  return timingSafeEqual(Buffer.from(tokenHash(token),"hex"),Buffer.from(hash,"hex"));
}
function clean(s){return String(s??"").normalize("NFKD").replace(/[^\x20-\x7e\n]/g,"-");}
export async function createPdf(title, sections){
  const doc=await PDFDocument.create();const font=await doc.embedFont(StandardFonts.Helvetica);const bold=await doc.embedFont(StandardFonts.HelveticaBold);
  let page,y;
  const next=()=>{page=doc.addPage([612,792]);y=748;page.drawText("THE CAREER ARCHITECT",{x:48,y:768,size:10,font:bold,color:rgb(.08,.45,.32)});};
  next();
  const line=(text,{size=10,heavy=false,gap=3}={})=>{
    const f=heavy?bold:font, max=516;let current="";
    const write=()=>{if(y<65)next();page.drawText(current||" ",{x:48,y,size,font:f,color:rgb(.08,.12,.2)});y-=size+gap;current="";};
    for(const word of clean(text).split(/\s+/)){
      const candidate=current?current+" "+word:word;
      if(f.widthOfTextAtSize(candidate,size)>max&&current)write();
      current=word.length>120?word.slice(0,120):word;
      if(f.widthOfTextAtSize(candidate,size)<=max)current=candidate;
    }
    write();
  };
  line(title,{size:19,heavy:true,gap:10});y-=9;
  for(const [heading,body] of sections){
    if(heading){y-=9;line(heading,{size:12,heavy:true,gap:7});}
    for(const paragraph of (Array.isArray(body)?body:[body])){
      for(const raw of clean(paragraph).split("\n"))line(raw||" ",{gap:4});
      y-=5;
    }
  }
  return Buffer.from(await doc.save());
}
export function reportSections(record){
  const p=record.data.package,a=p.ats,g=p.guide;
  const roles=(a.job_recommendations||[]).map(r=>`${r.fit==="apply_now"?"Apply now":"Build toward"}: ${r.title}. ${r.reason} Next: ${r.next_step}`);
  return [["Candidate",`${record.full_name} | ${record.field||"Career assessment"}`],["ATS readiness estimate",`${a.ats_score}/100 - ${a.verdict}\nThis is an estimate of résumé readiness, not a hiring probability.`],["Career assessment",g.overview],["Strengths",a.strengths],["Gaps and improvements",[...a.gaps,...a.rewrite_tips]],["Jobs to apply for",roles],["Action plan",g.action_plan]];
}
export function prepSections(record){
  const guide=record.data.package.guide;
  return [["Candidate",record.full_name],["Interview questions",(guide.interview_questions||[]).map((q,i)=>`${i+1}. ${q.question}\nWhy asked: ${q.why_asked}\nAnswer guidance: ${q.answer_guidance}`)],["Preparation tips",guide.interview_tips||[]],["Practice with your AI coach","Your private practice link is included in the email. Use your real experience when answering."]];
}
export async function pdfBundle(record){
  const [report,resume,prep]=await Promise.all([
    createPdf("Career report",reportSections(record)),
    createPdf("Tailored résumé",[["Tailored résumé",record.data.package.guide.tailored_resume],["What changed",record.data.package.guide.resume_changes]]),
    createPdf("Interview preparation",prepSections(record))
  ]);
  return [
    {filename:"career-report.pdf",content:report.toString("base64")},
    {filename:"tailored-resume.pdf",content:resume.toString("base64")},
    {filename:"interview-prep.pdf",content:prep.toString("base64")}
  ];
}

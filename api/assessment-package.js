import { getServiceClient } from "../lib/knowledge.js";
import { analyzeResume } from "../lib/ats-analysis.js";
import { createPdf, generatePackage, newToken, tokenHash, reportSections } from "../lib/candidate-package.js";
import { rateLimit } from "../lib/ratelimit.js";

export default async function handler(req,res){
  if(req.method!=="POST"){res.status(405).json({error:"Method not allowed"});return;}
  const rl=await rateLimit(req,{limit:20,windowMs:60_000});
  if(!rl.ok){res.status(429).json({error:"Too many requests"});return;}
  try{
    const sb=getServiceClient();if(!sb){res.status(503).json({error:"Database unavailable"});return;}
    const token=String(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
    const {data:u,error:ue}=await sb.auth.getUser(token);
    if(ue||!u?.user){res.status(401).json({error:"Sign in as admin"});return;}
    const {data:admin,error:ae}=await sb.from("admins").select("id").eq("id",u.user.id).maybeSingle();
    if(ae||!admin){res.status(403).json({error:"Admins only"});return;}
    const {id,action,kind}=req.body||{};
    if(!/^[a-f0-9-]{36}$/i.test(String(id))){res.status(400).json({error:"Invalid assessment"});return;}
    const {data:record,error}=await sb.from("assessments").select("id,full_name,email,field,data").eq("id",id).maybeSingle();
    if(error||!record){res.status(404).json({error:"Assessment not found"});return;}
    const d=record.data||{};
    if(action==="generate"){
      if(String(d.resume||"").trim().length<80){res.status(400).json({error:"This older intake has no résumé. Ask the candidate to submit a new assessment."});return;}
      if(!process.env.ANTHROPIC_API_KEY){res.status(503).json({error:"AI unavailable"});return;}
      const ats=await analyzeResume(String(d.resume).slice(0,24000));
      const guide=await generatePackage(d,ats);
      const next={...d,package:{ats,guide,generated_at:new Date().toISOString()},delivery:null};
      const {error:save}=await sb.from("assessments").update({data:next}).eq("id",id);
      if(save)throw save;
      res.status(200).json({package:next.package});return;
    }
    if(!d.package){res.status(400).json({error:"Generate the package first"});return;}
    if(action==="get"){res.status(200).json({package:d.package,delivery:d.delivery?{sent_at:d.delivery.sent_at}:null});return;}
    if(action==="pdf"){
      const sections=kind==="resume"?[["Tailored résumé",d.package.guide.tailored_resume],["What changed",d.package.guide.resume_changes]]:reportSections(record);
      const pdf=await createPdf(kind==="resume"?"Tailored résumé":"Career report and interview prep",sections);
      res.setHeader("Content-Type","application/pdf");res.setHeader("Content-Disposition",`attachment; filename="${kind==="resume"?"tailored-resume":"career-report"}.pdf"`);res.status(200).end(pdf);return;
    }
    if(action==="send"){
      if(!process.env.RESEND_API_KEY){res.status(503).json({error:"Email unavailable"});return;}
      if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(record.email||"")){res.status(400).json({error:"Candidate email is missing or invalid"});return;}
      if(d.delivery?.sent_at&&!req.body?.resend){res.status(409).json({error:"Already sent. Refresh before sending again."});return;}
      const [report,resume]=await Promise.all([
        createPdf("Career report and interview prep",reportSections(record)),
        createPdf("Tailored résumé",[["Tailored résumé",d.package.guide.tailored_resume],["What changed",d.package.guide.resume_changes]])
      ]);
      const chatToken=newToken();
      const pending={...d,delivery:{token_hash:tokenHash(chatToken)}};
      const {error:tokenSave}=await sb.from("assessments").update({data:pending}).eq("id",id);
      if(tokenSave)throw tokenSave;
      const url=`https://thecareerarchitect.org/prep.html?id=${encodeURIComponent(id)}&token=${encodeURIComponent(chatToken)}`;
      const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({
        from:process.env.FROM_EMAIL||"The Career Architect <hello@thecareerarchitect.org>",to:[record.email],subject:"Your career report, tailored résumé and interview prep",
        html:`<div style="font-family:Arial,sans-serif;color:#13213b;max-width:600px"><h2>Your career materials are ready</h2><p>Hi ${String(record.full_name||"there").split(" ")[0].replace(/[<>&"']/g,"")},</p><p>Your career report and tailored résumé are attached as PDFs. The report includes your ATS readiness estimate, recommended job types, action plan, and interview preparation.</p><p><a href="${url}">Continue interview prep with your private AI coach</a></p><p>Keep this link private. Reply to this email if you need a change.</p></div>`,
        attachments:[{filename:"career-report.pdf",content:report.toString("base64")},{filename:"tailored-resume.pdf",content:resume.toString("base64")}]
      })});
      if(!response.ok){console.error("Resend delivery failed",response.status,await response.text());res.status(502).json({error:"Email delivery failed; please retry"});return;}
      const next={...pending,delivery:{...pending.delivery,sent_at:new Date().toISOString()}};
      const {error:save}=await sb.from("assessments").update({data:next}).eq("id",id);
      if(save){console.error("Delivery status save failed",save);res.status(200).json({ok:true,warning:"Email sent, but delivery status could not be saved"});return;}
      res.status(200).json({ok:true,sent_at:next.delivery.sent_at});return;
    }
    res.status(400).json({error:"Unknown action"});
  }catch(e){console.error("Assessment package failed",e);res.status(502).json({error:"Could not complete this action. Please try again."});}
}

import { getServiceClient } from "../lib/knowledge.js";
import { analyzeResume } from "../lib/ats-analysis.js";
import { createPdf, generatePackage, reportSections, prepSections } from "../lib/candidate-package.js";
import { sendMaterials } from "../lib/assessment-delivery.js";
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
      if(["processing","sending"].includes(d.delivery_status)){res.status(409).json({error:"Automatic delivery is in progress"});return;}
      if(String(d.resume||"").trim().length<80){res.status(400).json({error:"This older intake has no résumé. Ask the candidate to submit a new assessment."});return;}
      if(!process.env.ANTHROPIC_API_KEY){res.status(503).json({error:"AI unavailable"});return;}
      const ats=await analyzeResume(String(d.resume).slice(0,24000));
      const guide=await generatePackage(d,ats);
      const next={...d,package:{ats,guide,generated_at:new Date().toISOString()},delivery:null,delivery_status:"ready",delivery_error:null};
      const {error:save}=await sb.from("assessments").update({data:next}).eq("id",id);
      if(save)throw save;
      res.status(200).json({package:next.package});return;
    }
    if(!d.package){res.status(400).json({error:"Generate the package first"});return;}
    if(action==="get"){res.status(200).json({package:d.package,delivery:d.delivery?{sent_at:d.delivery.sent_at}:null});return;}
    if(action==="pdf"){
      if(!["report","resume","prep"].includes(kind)){res.status(400).json({error:"Unknown PDF"});return;}
      const sections=kind==="resume"?[["Tailored résumé",d.package.guide.tailored_resume],["What changed",d.package.guide.resume_changes]]:kind==="prep"?prepSections(record):reportSections(record);
      const pdf=await createPdf(kind==="resume"?"Tailored résumé":kind==="prep"?"Interview preparation":"Career report",sections);
      res.setHeader("Content-Type","application/pdf");res.setHeader("Content-Disposition",`attachment; filename="${kind==="resume"?"tailored-resume":kind==="prep"?"interview-prep":"career-report"}.pdf"`);res.status(200).end(pdf);return;
    }
    if(action==="send"){
      if(["processing","sending"].includes(d.delivery_status)){res.status(409).json({error:"Automatic delivery is in progress"});return;}
      if(d.delivery?.sent_at&&!req.body?.resend){res.status(409).json({error:"Already sent. Refresh before sending again."});return;}
      const result=await sendMaterials(sb,record,{manual:true});
      res.status(200).json(result);return;
    }
    res.status(400).json({error:"Unknown action"});
  }catch(e){console.error("Assessment package failed",e);res.status(502).json({error:"Could not complete this action. Please try again."});}
}

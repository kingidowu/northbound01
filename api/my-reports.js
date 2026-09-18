import { getServiceClient } from "../lib/knowledge.js";
import { createPdf, reportSections, prepSections } from "../lib/candidate-package.js";

export function canAccessReport(record,user){
  if(!record||!user)return false;
  if(record.data?.user_id===user.id&&record.data?.report_tier==="paid")return true;
  return !!(!record.data?.user_id&&record.data?.package&&record.data?.delivery?.sent_at&&user.email_confirmed_at&&String(record.email||"").toLowerCase()===String(user.email||"").toLowerCase());
}

export default function handler(req,res){return handleReports(req,res,getServiceClient());}

export async function handleReports(req,res,sb){
  if(req.method!=="GET"){res.status(405).json({error:"Method not allowed"});return;}
  const token=/^Bearer\s+(.+)$/i.exec(String(req.headers.authorization||""))?.[1];
  if(!token){res.status(401).json({error:"Sign in to see your reports"});return;}
  if(!sb){res.status(503).json({error:"Report service unavailable"});return;}
  try{
    const {data:auth,error:authError}=await sb.auth.getUser(token);
    if(authError||!auth?.user){res.status(401).json({error:"Sign in again"});return;}
    res.setHeader("Cache-Control","private, no-store");
    const id=String(req.query?.id||"");
    if(!id){
      const {data,error}=await sb.from("assessments").select("id,full_name,field,created_at,data").eq("data->>user_id",auth.user.id).eq("data->>report_tier","paid").order("created_at",{ascending:false}).limit(50);
      if(error)throw error;
      let legacy=[];
      if(auth.user.email_confirmed_at&&auth.user.email){
        const result=await sb.from("assessments").select("id,full_name,email,field,created_at,data").ilike("email",auth.user.email).order("created_at",{ascending:false}).limit(50);
        if(result.error)throw result.error;
        legacy=(result.data||[]).filter(x=>canAccessReport(x,auth.user));
      }
      const rows=[...(data||[]),...legacy].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).slice(0,50);
      res.status(200).json({reports:rows.map(x=>({id:x.id,full_name:x.full_name,field:x.field,created_at:x.created_at,status:x.data?.delivery_status||"pending",ready:!!x.data?.package,ats_score:x.data?.package?.ats?.ats_score??null}))});return;
    }
    if(!/^[a-f0-9-]{36}$/i.test(id)){res.status(400).json({error:"Invalid report"});return;}
    const kind=String(req.query?.kind||"");
    if(!["report","resume","prep"].includes(kind)){res.status(400).json({error:"Choose a PDF"});return;}
    const {data:record,error}=await sb.from("assessments").select("id,full_name,email,field,data").eq("id",id).maybeSingle();
    if(error)throw error;
    if(!canAccessReport(record,auth.user)){res.status(404).json({error:"Report not found"});return;}
    if(!record.data?.package){res.status(409).json({error:"Your PDFs are still being prepared"});return;}
    const guide=record.data.package.guide;
    const sections=kind==="report"?reportSections(record):kind==="prep"?prepSections(record):[["Tailored résumé",guide.tailored_resume],["What changed",guide.resume_changes||[]]];
    const title=kind==="report"?"Career report":kind==="prep"?"Interview preparation":"Tailored résumé";
    const pdf=await createPdf(title,sections);
    const filename=kind==="report"?"career-report.pdf":kind==="prep"?"interview-prep.pdf":"tailored-resume.pdf";
    res.setHeader("Content-Type","application/pdf");res.setHeader("Content-Disposition",`attachment; filename="${filename}"`);res.status(200).end(pdf);
  }catch(error){console.error("My reports failed",error);res.status(502).json({error:"Could not load your reports"});}
}

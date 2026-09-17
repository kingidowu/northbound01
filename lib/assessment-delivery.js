import { randomUUID, randomBytes, createHash, createCipheriv, createDecipheriv } from "node:crypto";
import { analyzeResume } from "./ats-analysis.js";
import { generatePackage, newToken, tokenHash, pdfBundle } from "./candidate-package.js";
import { getServiceClient } from "./knowledge.js";

const SITE="https://thecareerarchitect.org";
const safeName=value=>String(value||"there").split(/\s+/)[0].replace(/[<>&"']/g,"");
const validEmail=value=>/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(value||""));
function secretKey(){return createHash("sha256").update(process.env.SUPABASE_SERVICE_ROLE_KEY||"").digest();}
function seal(token){const iv=randomBytes(12),cipher=createCipheriv("aes-256-gcm",secretKey(),iv);const value=Buffer.concat([cipher.update(token,"utf8"),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),value]).toString("base64url");}
function unseal(value){const data=Buffer.from(value,"base64url"),iv=data.subarray(0,12),tag=data.subarray(12,28),cipher=createDecipheriv("aes-256-gcm",secretKey(),iv);cipher.setAuthTag(tag);return Buffer.concat([cipher.update(data.subarray(28)),cipher.final()]).toString("utf8");}

export async function sendMaterials(sb,record,{manual=false}={}){
  if(!process.env.RESEND_API_KEY)throw Error("Email service is not configured");
  if(!validEmail(record.email))throw Error("Candidate email is missing or invalid");
  if(!record.data?.package)throw Error("Generate the package first");
  if(record.data.delivery?.sent_at&&!manual)return {skipped:true,sent_at:record.data.delivery.sent_at};
  const token=!manual&&record.data.delivery?.token_ciphertext?unseal(record.data.delivery.token_ciphertext):newToken();
  const next={...record.data,delivery_status:"sending",delivery:{token_hash:tokenHash(token),token_ciphertext:seal(token),attempted_at:new Date().toISOString()}};
  const {error:pendingError}=await sb.from("assessments").update({data:next}).eq("id",record.id);
  if(pendingError)throw pendingError;
  const url=`${SITE}/prep.html?id=${encodeURIComponent(record.id)}&token=${encodeURIComponent(token)}`;
  try{
  const attachments=await pdfBundle({...record,data:next});
  const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{
    Authorization:`Bearer ${process.env.RESEND_API_KEY}`,"Content-Type":"application/json",
    "Idempotency-Key":manual?`assessment-${record.id}-${randomUUID()}`:`assessment-${record.id}-materials-v1`
  },body:JSON.stringify({
    from:process.env.FROM_EMAIL||"The Career Architect <hello@thecareerarchitect.org>",to:[record.email],
    subject:"Your career report, tailored résumé, and interview prep",
    html:`<div style="font-family:Arial,sans-serif;color:#13213b;max-width:600px"><h2>Your career materials are ready</h2><p>Hi ${safeName(record.full_name)},</p><p>Attached are your career report, tailored résumé, and interview preparation as three separate PDFs. The report includes your ATS readiness estimate and recommended job types.</p><p><a href="${url}">Practice interviews with your private AI coach</a></p><p>Keep this link private. Reply to this email if you need a change.</p></div>`,
    attachments
  })});
  if(!response.ok){const detail=await response.text();console.error("Resend delivery failed",response.status,detail);throw Error(`Email delivery failed (${response.status})`);}
  const result=await response.json().catch(()=>({}));
  const sent_at=new Date().toISOString();
  const complete={...next,delivery_status:"sent",delivery:{token_hash:next.delivery.token_hash,sent_at,message_id:result.id||null}};
  const {error:saveError}=await sb.from("assessments").update({data:complete}).eq("id",record.id);
  if(saveError){console.error("Email sent but delivery status save failed",saveError);return {ok:true,sent_at,warning:"Email sent, but delivery status could not be saved"};}
  return {ok:true,sent_at};
  }catch(e){
    if(manual){
      const reset={...record.data,delivery_status:"ready",delivery_error:String(e.message||e).slice(0,300)};
      const {error:resetError}=await sb.from("assessments").update({data:reset}).eq("id",record.id);
      if(resetError)console.error("Could not restore manual delivery status",resetError);
    }
    throw e;
  }
}

export async function processAssessment(id,sb=getServiceClient()){
  if(!sb)throw Error("Database unavailable");
  const {data:record,error}=await sb.from("assessments").select("id,full_name,email,field,data").eq("id",id).maybeSingle();
  if(error||!record)throw error||Error("Assessment not found");
  const data=record.data||{};
  const status=data.delivery_status;
  const oldStart=String(data.delivery_started_at||"");
  const staleProcessing=status==="processing"&&oldStart&&Date.now()-Date.parse(oldStart)>10*60_000;
  const oldAttempt=String(data.delivery?.attempted_at||"");
  const staleSending=status==="sending"&&oldAttempt&&Date.now()-Date.parse(oldAttempt)>10*60_000;
  if(!["pending","retry"].includes(status)&&!staleProcessing&&!staleSending)return {skipped:true,status};
  const attempts=Number(data.delivery_attempts||0)+1;
  if(attempts>3){
    await sb.from("assessments").update({data:{...data,delivery_status:"failed",delivery_error:"Automatic delivery stopped after three attempts"}}).eq("id",id);
    return {skipped:true,status:"failed"};
  }
  const started=new Date().toISOString();
  const claimedData={...data,delivery_status:"processing",delivery_attempts:attempts,delivery_started_at:started,delivery_error:null};
  let claim=sb.from("assessments").update({data:claimedData}).eq("id",id).eq("data->>delivery_status",status);
  if(staleProcessing)claim=claim.eq("data->>delivery_started_at",oldStart);
  if(staleSending)claim=claim.eq("data->delivery->>attempted_at",oldAttempt);
  const {data:claimed,error:claimError}=await claim.select("id").maybeSingle();
  if(claimError)throw claimError;
  if(!claimed)return {skipped:true,status:"already_processing"};
  let current=claimedData;
  try{
    if(String(current.resume||"").trim().length<80)throw Error("No readable résumé");
    if(!current.package){
      const ats=await analyzeResume(String(current.resume).slice(0,24000));
      const guide=await generatePackage(current,ats);
      current={...current,package:{ats,guide,generated_at:new Date().toISOString()}};
      const {data:stored,error:saveError}=await sb.from("assessments").update({data:current}).eq("id",id).eq("data->>delivery_started_at",started).select("id").maybeSingle();
      if(saveError||!stored)throw saveError||Error("Delivery claim was replaced");
    }
    return await sendMaterials(sb,{...record,data:current});
  }catch(e){
    console.error("Automatic assessment delivery failed",id,e);
    const {data:latest}=await sb.from("assessments").select("data").eq("id",id).maybeSingle();
    const retry={...(latest?.data||current),delivery_status:attempts>=3?"failed":"retry",delivery_error:String(e.message||e).slice(0,300)};
    await sb.from("assessments").update({data:retry}).eq("id",id);
    throw e;
  }
}

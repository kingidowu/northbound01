import Anthropic from "@anthropic-ai/sdk";
import { getServiceClient } from "../lib/knowledge.js";
import { validToken } from "../lib/candidate-package.js";
import { rateLimit } from "../lib/ratelimit.js";
const ai=new Anthropic();
export default async function handler(req,res){
  if(req.method!=="POST"){res.status(405).json({error:"Method not allowed"});return;}
  const rl=await rateLimit(req,{limit:20,windowMs:60_000});if(!rl.ok){res.status(429).json({error:"Too many messages. Wait a minute."});return;}
  try{
    const {id,token,history=[],message}=req.body||{};
    if(!/^[a-f0-9-]{36}$/i.test(String(id))){res.status(400).json({error:"Invalid link"});return;}
    const sb=getServiceClient();if(!sb){res.status(503).json({error:"Service unavailable"});return;}
    const {data:record}=await sb.from("assessments").select("full_name,data").eq("id",id).maybeSingle();
    if(!record||!validToken(token,record.data?.delivery?.token_hash)){res.status(403).json({error:"This private link is invalid. Ask your career advisor for a new link."});return;}
    const pkg=record.data.package;
    if(!pkg){res.status(404).json({error:"Interview prep unavailable"});return;}
    if(!message){res.status(200).json({name:record.full_name,questions:pkg.guide.interview_questions,tips:pkg.guide.interview_tips,roles:pkg.ats.job_recommendations});return;}
    const userMessage=String(message).trim().slice(0,1200);
    if(!userMessage){res.status(400).json({error:"Enter a question or answer"});return;}
    const turns=(Array.isArray(history)?history:[]).slice(-8).filter(x=>["user","assistant"].includes(x?.role)).map(x=>({role:x.role,content:String(x.content||"").slice(0,1200)}));
    if(turns.length&&turns[0].role==="assistant")turns.shift();
    const msgs=[];for(const turn of turns){if(msgs.length&&msgs.at(-1).role===turn.role)msgs.at(-1).content+="\n"+turn.content;else msgs.push({...turn});}
    if(msgs.at(-1)?.role==="user")msgs.at(-1).content+="\n"+userMessage;else msgs.push({role:"user",content:userMessage});
    const response=await ai.messages.create({model:"claude-haiku-4-5",max_tokens:800,
      system:`You are a supportive, direct interview coach for ${record.full_name}. Use their real résumé and prepared questions. Ask one question at a time when practicing. On answers, give specific feedback, a stronger structure, and a follow-up. Never invent candidate experience or claim a job is guaranteed. Keep responses under 250 words. RÉSUMÉ: ${String(record.data.resume||"").slice(0,10000)}\nPREP: ${JSON.stringify(pkg.guide.interview_questions).slice(0,9000)}`,
      messages:msgs});
    res.status(200).json({reply:response.content.find(x=>x.type==="text")?.text||"Please try again."});
  }catch(e){console.error("Prep chat failed",e);res.status(502).json({error:"The coach is unavailable. Please try again."});}
}

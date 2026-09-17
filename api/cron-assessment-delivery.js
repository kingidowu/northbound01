import { getServiceClient } from "../lib/knowledge.js";
import { processAssessment } from "../lib/assessment-delivery.js";

export default async function handler(req,res){
  if(req.method!=="GET"){res.status(405).json({error:"Method not allowed"});return;}
  if(!process.env.CRON_SECRET||req.headers.authorization!==`Bearer ${process.env.CRON_SECRET}`){res.status(401).json({error:"Unauthorized"});return;}
  const sb=getServiceClient();if(!sb){res.status(503).json({error:"Database unavailable"});return;}
  const {data,error}=await sb.from("assessments").select("id,data").in("data->>delivery_status",["pending","retry","processing","sending"]).order("created_at",{ascending:true}).limit(30);
  if(error){console.error("Delivery retry query failed",error);res.status(502).json({error:"Could not load pending assessments"});return;}
  const eligible=(data||[]).filter(row=>{
    const status=row.data?.delivery_status;
    if(status==="processing")return Date.now()-Date.parse(row.data.delivery_started_at||"")>10*60_000;
    if(status==="sending")return Date.now()-Date.parse(row.data.delivery?.attempted_at||"")>10*60_000;
    return true;
  }).slice(0,3);
  const outcomes=await Promise.allSettled(eligible.map(row=>processAssessment(row.id,sb)));
  res.status(200).json({checked:eligible.length,sent:outcomes.filter(x=>x.status==="fulfilled"&&x.value?.ok).length,failed:outcomes.filter(x=>x.status==="rejected").length});
}

import { getServiceClient } from "../lib/knowledge.js";
import { accessLevel } from "../lib/entitlement.js";

export default async function handler(req,res){
  if(req.method!=="GET"){res.status(405).json({error:"Method not allowed"});return;}
  const token=String(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
  if(!token){res.status(401).json({error:"Sign in to view your account"});return;}
  const sb=getServiceClient();
  if(!sb){res.status(503).json({error:"Account service unavailable"});return;}
  try{
    const {data,error}=await sb.auth.getUser(token);
    if(error||!data?.user){res.status(401).json({error:"Sign in again"});return;}
    const level=await accessLevel(sb,data.user.id);
    res.setHeader("Cache-Control","private, no-store");
    res.status(200).json({plan:level.plan,admin:level.plan==="admin",unlimited:level.unlimited});
  }catch(error){console.error("Account status failed",error);res.status(503).json({error:"Could not verify account access"});}
}

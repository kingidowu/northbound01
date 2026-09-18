import { getServiceClient } from "../lib/knowledge.js";

export default function handler(req,res){return handleBilling(req,res,getServiceClient());}

export async function handleBilling(req,res,sb){
  if(req.method!=="POST"){res.status(405).json({error:"Method not allowed"});return;}
  const token=/^Bearer\s+(.+)$/i.exec(String(req.headers.authorization||""))?.[1];
  if(!token){res.status(401).json({error:"Sign in to manage billing"});return;}
  if(!sb||!process.env.STRIPE_SECRET_KEY){res.status(503).json({error:"Billing is unavailable"});return;}
  try{
    const {data:auth,error:authError}=await sb.auth.getUser(token);
    if(authError||!auth?.user){res.status(401).json({error:"Sign in again"});return;}
    const {data:membership,error}=await sb.from("memberships").select("stripe_customer_id").eq("user_id",auth.user.id).maybeSingle();
    if(error)throw error;
    if(!membership?.stripe_customer_id){res.status(404).json({error:"No subscription billing account was found. Contact support if you were charged."});return;}
    const body=new URLSearchParams({customer:membership.stripe_customer_id,return_url:"https://thecareerarchitect.org/seeker.html"});
    const response=await fetch("https://api.stripe.com/v1/billing_portal/sessions",{method:"POST",headers:{Authorization:`Bearer ${process.env.STRIPE_SECRET_KEY}`,"Content-Type":"application/x-www-form-urlencoded"},body});
    const session=await response.json();
    if(!response.ok||!session.url)throw Error(session.error?.message||"Could not open billing portal");
    res.status(200).json({url:session.url});
  }catch(error){console.error("Billing portal failed",error);res.status(502).json({error:"Could not open billing settings. Please try again."});}
}

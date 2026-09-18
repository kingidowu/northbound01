import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import reports,{canAccessReport,handleReports} from "../api/my-reports.js";
import billing,{handleBilling} from "../api/billing-portal.js";
import { verify } from "../api/stripe-webhook.js";

function response(){return {code:null,body:null,status(n){this.code=n;return this;},json(value){this.body=value;return this;},setHeader(){return this;}};}

test("private report and billing endpoints reject anonymous requests",async()=>{
  const a=response(),b=response();
  await reports({method:"GET",headers:{},query:{}},a);
  await billing({method:"POST",headers:{}},b);
  assert.equal(a.code,401);
  assert.equal(b.code,401);
});

test("Stripe signatures reject stale and tampered events",()=>{
  const secret="whsec_test",raw=Buffer.from('{"type":"test"}');
  const timestamp=Math.floor(Date.now()/1000);
  const signature=createHmac("sha256",secret).update(`${timestamp}.${raw}`).digest("hex");
  assert.equal(verify(raw,`t=${timestamp},v1=${signature}`,secret),true);
  assert.equal(verify(Buffer.from("changed"),`t=${timestamp},v1=${signature}`,secret),false);
  assert.equal(verify(raw,`t=${timestamp-601},v1=${signature}`,secret),false);
});

test("report ownership requires paid user id or a confirmed legacy email",()=>{
  const user={id:"member-1",email:"owner@example.com",email_confirmed_at:"2026-09-01"};
  assert.equal(canAccessReport({data:{user_id:"member-1",report_tier:"paid"}},user),true);
  assert.equal(canAccessReport({data:{user_id:"other",report_tier:"paid"}},user),false);
  const legacy={email:"OWNER@example.com",data:{package:{},delivery:{sent_at:"2026-09-01"}}};
  assert.equal(canAccessReport(legacy,user),true);
  assert.equal(canAccessReport(legacy,{...user,email_confirmed_at:null}),false);
  assert.equal(canAccessReport({...legacy,email:"other@example.com"},user),false);
});

test("report downloads reject another member's report",async()=>{
  const record={id:"12345678-1234-1234-1234-123456789012",data:{user_id:"other",report_tier:"paid",package:{}}};
  const sb={auth:{getUser:async()=>({data:{user:{id:"member-1",email:"owner@example.com"}}})},from:()=>({select(){return this;},eq(){return this;},async maybeSingle(){return {data:record};}})};
  const res=response();
  await handleReports({method:"GET",headers:{authorization:"Bearer valid"},query:{id:record.id,kind:"report"}},res,sb);
  assert.equal(res.code,404);
});

test("billing portal uses the authenticated member's Stripe customer",async()=>{
  const previousKey=process.env.STRIPE_SECRET_KEY,previousFetch=global.fetch;
  process.env.STRIPE_SECRET_KEY="sk_test_only";
  let sent;
  global.fetch=async(_url,options)=>{sent=options;return {ok:true,json:async()=>({url:"https://billing.stripe.com/session"})};};
  const sb={auth:{getUser:async()=>({data:{user:{id:"member-1"}}})},from:()=>({select(){return this;},eq(){return this;},async maybeSingle(){return {data:{stripe_customer_id:"cus_owned"}};}})};
  try{
    const res=response();
    await handleBilling({method:"POST",headers:{authorization:"Bearer valid"},body:{customer:"cus_attacker"}},res,sb);
    assert.equal(res.code,200);
    assert.equal(new URLSearchParams(sent.body).get("customer"),"cus_owned");
  }finally{global.fetch=previousFetch;if(previousKey===undefined)delete process.env.STRIPE_SECRET_KEY;else process.env.STRIPE_SECRET_KEY=previousKey;}
});

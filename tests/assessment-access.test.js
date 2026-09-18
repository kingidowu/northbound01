import test from "node:test";
import assert from "node:assert/strict";
import { assessmentAccess } from "../lib/assessment-access.js";

const sb={
  auth:{getUser:async()=>({data:{user:{id:"member-1",email:"member@example.com"}}})},
  from(table){
    return {select(){return this;},eq(){return this;},async maybeSingle(){
      return {data:table==="admins"?null:{plan:"pro",status:"active"}};
    }};
  }
};

test("automatic PDF access requires a paid account and matching verified email",async()=>{
  assert.deepEqual(await assessmentAccess(sb,"","member@example.com"),{paid:false,userId:null,plan:"free"});
  const allowed=await assessmentAccess(sb,"Bearer valid","MEMBER@example.com");
  assert.equal(allowed.paid,true);
  assert.equal(allowed.userId,"member-1");
  const mismatch=await assessmentAccess(sb,"Bearer valid","other@example.com");
  assert.equal(mismatch.status,400);
});

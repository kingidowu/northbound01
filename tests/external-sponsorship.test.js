import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/external-jobs.js";

test("sponsorship search keeps only explicit offers relevant to the role",async()=>{
  const oldFetch=global.fetch,oldId=process.env.ADZUNA_APP_ID,oldKey=process.env.ADZUNA_APP_KEY;
  process.env.ADZUNA_APP_ID="test";process.env.ADZUNA_APP_KEY="test";
  global.fetch=async url=>{
    const host=new URL(url).hostname;
    const data=host.includes("adzuna")?{results:[
      {id:"1",title:"Cloud Engineer",company:{display_name:"A"},description:"Visa sponsorship is available for this role."},
      {id:"2",title:"Cloud Engineer II",company:{display_name:"B"},description:"We do not provide visa sponsorship."},
      {id:"3",title:"Nurse",company:{display_name:"C"},description:"Visa sponsorship is available."}
    ]}:host.includes("remotive")?{jobs:[]}:host.includes("remoteok")?[]:host.includes("arbeitnow")?{data:[]}:host.includes("jobicy")?{jobs:[]}:{results:[]};
    return {ok:true,json:async()=>data};
  };
  const req={method:"POST",headers:{"x-forwarded-for":"test-sponsor"},body:{what:"cloud engineer",country:"us",sponsorship:true,relevance:false}};
  let result;const res={status(code){this.code=code;return this;},json(value){result=value;return this;},setHeader(){}};
  try{
    await handler(req,res);
    assert.equal(res.code,200);
    assert.deepEqual(result.jobs.map(j=>j.title),["Cloud Engineer"]);
    assert.equal(result.jobs[0].visa_sponsorship,true);
    assert.match(result.jobs[0].sponsorship_evidence,/sponsorship is available/i);
  }finally{
    global.fetch=oldFetch;
    if(oldId===undefined)delete process.env.ADZUNA_APP_ID;else process.env.ADZUNA_APP_ID=oldId;
    if(oldKey===undefined)delete process.env.ADZUNA_APP_KEY;else process.env.ADZUNA_APP_KEY=oldKey;
  }
});

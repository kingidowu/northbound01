import test from "node:test";
import assert from "node:assert/strict";
import { accessLevel } from "../lib/entitlement.js";

function fakeDb({admin=false,membership=null}={}){
  const calls=[];
  return {calls,from(table){calls.push(table);return {select(){return this;},eq(){return this;},async maybeSingle(){return {data:table==="admins"?(admin?{id:"owner"}:null):membership,error:null};}};}};
}
test("admin access takes priority over a missing paid membership",async()=>{
  const db=fakeDb({admin:true});
  assert.deepEqual(await accessLevel(db,"owner"),{plan:"admin",unlimited:true});
  assert.deepEqual(db.calls,["admins"]);
});
test("non-admin accounts retain their paid or free plan",async()=>{
  assert.deepEqual(await accessLevel(fakeDb({membership:{plan:"pro",status:"active"}}),"user"),{plan:"pro",unlimited:true});
  assert.deepEqual(await accessLevel(fakeDb(),"user"),{plan:"free",unlimited:false});
});

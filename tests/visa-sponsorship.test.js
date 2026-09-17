import test from "node:test";
import assert from "node:assert/strict";
import { sponsorshipEvidence } from "../lib/visa-sponsorship.js";

test("marks only explicit offers for this role",()=>{
  for(const text of [
    "Visa sponsorship is available for qualified candidates.",
    "We offer visa sponsorship for this role.",
    "Visa Sponsorship: Yes. Relocation support provided.",
    "The employer will sponsor H-1B visa applicants.",
  ]) assert.ok(sponsorshipEvidence(text),text);
});
test("does not mark refusals or ambiguous mentions",()=>{
  for(const text of [
    "We do not provide visa sponsorship.",
    "You must be authorized to work in the United States without current or future employer sponsorship.",
    "Visa sponsorship is not available.",
    "Candidates should tell us if they need sponsorship.",
    "Our company has sponsored visas in the past.",
    "Relocation and visa assistance included.",
  ]) assert.equal(sponsorshipEvidence(text),null,text);
});

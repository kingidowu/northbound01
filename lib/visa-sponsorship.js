// Only mark a web listing when its own text explicitly offers sponsorship.
// A company's past sponsorship or a generic mention is not evidence for this role.
const negative = [
  /\b(?:no|not|never|without|cannot|can't|won't|will not|unable to|do not|does not|don't|doesn't)\b[^.!?;\n]{0,90}\b(?:sponsor(?:ship|ing)?|visa assistance|visa support)\b/i,
  /\b(?:sponsor(?:ship|ing)?|visa assistance|visa support)\b[^.!?;\n]{0,50}\b(?:not available|not offered|not provided|unavailable|not possible)\b/i,
  /\b(?:must|need to|required to)\b[^.!?;\n]{0,90}\b(?:work authorization|authorized to work)\b[^.!?;\n]{0,70}\bwithout\b[^.!?;\n]{0,40}\bsponsor/i,
];
const positive = [
  /\b(?:visa|work visa|employment visa|h[ -]?1b|h[ -]?1b visa)\s+sponsorship\s+(?:is\s+)?(?:available|offered|provided|included|supported)\b/i,
  /\b(?:offer|offers|provide|provides|support|supports|will provide|can provide|able to provide)\s+(?:(?:work|employment|h[ -]?1b)\s+)?visa\s+sponsorship\b/i,
  /\b(?:we|the employer|the company|this role)\s+(?:can|will|do)\s+sponsor\b[^.!?;\n]{0,50}\b(?:visa|h[ -]?1b|work permit|candidate|applicant)/i,
  /\b(?:sponsorship\s+for\s+(?:h[ -]?1b|work visas?)|h[ -]?1b\s+sponsorship)\s+(?:is\s+)?(?:available|offered|provided)\b/i,
  /\b(?:visa\s+sponsorship|h[ -]?1b\s+sponsorship)\s*[:\-]\s*(?:yes|available|offered|provided)\b/i,
];

export function sponsorshipEvidence(value){
  const text=String(value||"").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim();
  if(!text) return null;
  // Disqualify an explicit refusal anywhere in the listing; mixed wording needs human review.
  if(negative.some(pattern=>pattern.test(text)))return null;
  for(const pattern of positive){
    const match=pattern.exec(text);
    if(match){
      const start=Math.max(0,match.index-35),end=Math.min(text.length,match.index+match[0].length+55);
      return text.slice(start,end).trim();
    }
  }
  return null;
}

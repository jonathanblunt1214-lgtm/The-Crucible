const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function hash(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex'); }
function text(value, label) { if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`); return value.trim().replace(/\s+/g, ' '); }
// `claimBoundary` carries provenance: extraction builds it from the source document, so two
// independent documents never produce the same string. Comparing scope with it therefore made
// corroboration by independent sources structurally impossible - every real pair routed to
// `bounded-scope-or-version-update` and could never reach evaluation, which is why extracted
// evidence could never be promoted no matter how sound the claim.
//
// `claimScope` separates the two ideas. It is the declared scope the claim was tested within,
// which is a property of the claim rather than of the document that asserted it, so two sources
// can share it. It is optional and never inferred: a candidate without one behaves exactly as
// before, so nothing already recorded changes meaning, and extraction cannot invent a scope it
// has no way to know.
function sourceClaim(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a bounded source claim.`);
  const keys=Object.keys(value).sort().filter((key)=>key!=='claimScope');
  if (keys.join(',') !== 'claim,claimBoundary,generalizationBoundary,sourceId') throw new Error(`${label} has unknown or missing fields.`);
  const declaredScope = value.claimScope === undefined || value.claimScope === null ? null : text(value.claimScope, `${label}.claimScope`);
  return { sourceId:text(value.sourceId,`${label}.sourceId`), claim:text(value.claim,`${label}.claim`), claimBoundary:text(value.claimBoundary,`${label}.claimBoundary`), generalizationBoundary:text(value.generalizationBoundary,`${label}.generalizationBoundary`), claimScope:declaredScope };
}
// The scope two sources are compared on: the declared one when present, otherwise the
// provenance boundary, which preserves the previous behaviour exactly.
function comparableScope(source) { return source.claimScope || source.claimBoundary; }
function normalized(value) { return text(value,'claim').toLowerCase(); }
function routeThreeWayComparison({ projectId, candidateId, sourceA, sourceB, activeKnowledge, comparedAt }) {
  text(projectId,'projectId'); text(candidateId,'candidateId'); text(comparedAt,'comparedAt'); if (!Number.isFinite(Date.parse(comparedAt))) throw new Error('comparedAt must be an ISO timestamp.');
  const a=sourceClaim(sourceA,'sourceA'); const b=sourceClaim(sourceB,'sourceB'); if (a.sourceId === b.sourceId) throw new Error('Three-way comparison requires two independently identified sources.');
  if (!Array.isArray(activeKnowledge)) throw new Error('Active verified knowledge must be an array.');
  for (const item of activeKnowledge) if (!item || item.projectId !== projectId || item.status !== 'active' || typeof item.claim !== 'string' || typeof item.boundary !== 'string') throw new Error('Only same-project active verified knowledge may be compared.');
  const sourcesAgree=normalized(a.claim) === normalized(b.claim); const sameScope=comparableScope(a) === comparableScope(b) && a.generalizationBoundary === b.generalizationBoundary;
  let route; let classification='Insufficient Evidence'; let nextAction; let knowledgeVersion=null;
  if (!sameScope) { route='bounded-scope-or-version-update'; nextAction='evaluate-each-bounded-claim-separately'; }
  else if (!sourcesAgree) { route='contradiction-review'; classification='Crucible Issue'; nextAction='obtain-additional-independent-source-or-controlled-test'; }
  else {
    const exact=activeKnowledge.find((item)=>normalized(item.claim)===normalized(a.claim) && item.boundary===a.claimBoundary);
    const conflict=activeKnowledge.find((item)=>item.boundary===a.claimBoundary && normalized(item.claim)!==normalized(a.claim));
    if (exact) { route='corroboration-recorded'; nextAction='controlled-regression-test-without-relearning'; knowledgeVersion=exact.version; }
    else if (conflict) { route='possible-knowledge-update-quarantine'; classification='Crucible Issue'; nextAction='controlled-test-and-contradiction-analysis'; knowledgeVersion=conflict.version; }
    else { route='new-claim-evaluation'; nextAction='form-falsifiable-hypothesis-and-run-controlled-test'; }
  }
  const decision={ schemaVersion:1, projectId, candidateId, sourceIds:[a.sourceId,b.sourceId].sort(), claimSha256:hash(normalized(a.claim)), sourceClaimsAgree:sourcesAgree, sameScope, knowledgeVersion, route, classification, nextAction, comparedAt, proofStageSatisfied:false, independentVerificationSatisfied:false, promotionAllowed:false };
  return Object.freeze(decision);
}

class ClaimComparisonLedger {
  constructor({ root, projectId }) { this.root=path.resolve(text(root,'root')); this.projectId=text(projectId,'projectId'); this.file=path.join(this.root,'claim-comparison.json'); fs.mkdirSync(this.root,{recursive:true}); }
  read() { if (!fs.existsSync(this.file)) return { schemaVersion:1, projectId:this.projectId, decisions:[] }; const envelope=JSON.parse(fs.readFileSync(this.file,'utf8')); if (envelope?.sha256!==hash(envelope.payload) || envelope.payload?.schemaVersion!==1 || envelope.payload.projectId!==this.projectId || !Array.isArray(envelope.payload.decisions)) throw new Error('Claim comparison ledger integrity or project binding failed.'); return structuredClone(envelope.payload); }
  record(decision) { if (!decision || decision.projectId!==this.projectId || decision.schemaVersion!==1 || decision.promotionAllowed!==false || decision.independentVerificationSatisfied!==false || decision.proofStageSatisfied!==false) throw new Error('Only non-proof same-project routing decisions may be recorded.'); const state=this.read(); const id=`comparison-${hash(decision).slice(0,32)}`; const existing=state.decisions.find((item)=>item.id===id); if (existing) return { created:false, decision:structuredClone(existing) }; const item={ id, ...structuredClone(decision) }; state.decisions.push(item); const payload=state; const envelope={ payload, sha256:hash(payload) }; const temporary=`${this.file}.${process.pid}.${crypto.randomUUID()}.tmp`; fs.writeFileSync(temporary,`${JSON.stringify(envelope,null,2)}\n`,{flag:'wx',mode:0o600}); fs.renameSync(temporary,this.file); return { created:true, decision:structuredClone(item) }; }
}

module.exports={ routeThreeWayComparison, ClaimComparisonLedger };

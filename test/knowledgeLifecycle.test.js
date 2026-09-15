const test=require('node:test');const assert=require('node:assert/strict');const {KnowledgeLifecycleGovernor}=require('../src/knowledgeLifecycle');
test('age and change trigger review but cannot phase out active knowledge by judgment',()=>{const active={version:1,claim:'runtime behavior',boundary:'node-24',createdAt:'2026-01-01T00:00:00.000Z',status:'active',proofSha256:'a'.repeat(64)};const store={activeKnowledge:()=>[active],read:()=>({knowledgeVersions:[active]})};const governor=new KnowledgeLifecycleGovernor({store,now:()=> '2026-08-31T00:00:00.000Z',maximumUnreviewedDays:180});const review=governor.assess({signals:[{claim:active.claim,boundary:active.boundary,type:'authoritative-source-changed'}]})[0];assert.equal(review.state,'review-required');assert.equal(review.proofStageSatisfied,false);assert.throws(()=>governor.confirmSupersession({priorVersion:1,replacementVersion:2}),/only after/);});
test('only a distinct verified same-boundary active replacement confirms supersession',()=>{const prior={version:1,claim:'runtime behavior',boundary:'node-24',createdAt:'2026-01-01T00:00:00.000Z',status:'superseded',proofSha256:'a'.repeat(64)},replacement={version:2,previousVersion:1,claim:prior.claim,boundary:prior.boundary,createdAt:'2026-08-31T00:00:00.000Z',status:'active',proofSha256:'b'.repeat(64)};const store={activeKnowledge:()=>[replacement],read:()=>({knowledgeVersions:[prior,replacement]})};const result=new KnowledgeLifecycleGovernor({store}).confirmSupersession({priorVersion:1,replacementVersion:2});assert.equal(result.state,'superseded-not-retrieved');assert.equal(result.auditRetained,true);});
// Found by mutation: inverting `signal.claim===item.claim` in assess() left the whole suite
// green. The existing test passes a matching signal against a version that is also age-due, so
// the age path satisfies `review-required` whether or not the signal ever matched. This version
// is deliberately not age-due, which is what makes the signal path the only thing under test.
test('a signal attaches only to the version whose claim and boundary it names',()=>{const active={version:1,claim:'runtime behavior',boundary:'node-24',createdAt:'2026-08-01T00:00:00.000Z',status:'active',proofSha256:'a'.repeat(64)};const store={activeKnowledge:()=>[active],read:()=>({knowledgeVersions:[active]})};const governor=new KnowledgeLifecycleGovernor({store,now:()=>'2026-08-31T00:00:00.000Z',maximumUnreviewedDays:180});
  assert.deepEqual(governor.assess()[0].reasons,[],'not age-due, so nothing masks the signal path');
  const otherClaim=governor.assess({signals:[{claim:'something else entirely',boundary:active.boundary,type:'authoritative-source-changed'}]})[0];
  assert.equal(otherClaim.state,'current','a signal about a different claim must not put this version under review');
  assert.deepEqual(otherClaim.reasons,[]);
  const otherBoundary=governor.assess({signals:[{claim:active.claim,boundary:'node-20',type:'authoritative-source-changed'}]})[0];
  assert.equal(otherBoundary.state,'current','same claim, different boundary, is still a different thing');
  assert.deepEqual(otherBoundary.reasons,[]);
  const matching=governor.assess({signals:[{claim:active.claim,boundary:active.boundary,type:'authoritative-source-changed'}]})[0];
  assert.equal(matching.state,'review-required','and the matching signal must still land, or the filter could just reject everything');
  assert.deepEqual(matching.reasons,['authoritative-source-changed']);});

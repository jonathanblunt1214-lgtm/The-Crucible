'use strict';const crypto=require('node:crypto');
const canonical=(value)=>JSON.stringify(value,Object.keys(value).sort());
function verify(signature,payload,key,label){if(!key||!crypto.verify(null,Buffer.from(canonical(payload)),key,Buffer.from(signature||'','base64')))throw new Error(`${label} signature is invalid.`);}
class ExternalOversightReflex{
  constructor({projectId,oversightPublicKey,ownerPublicKey}){this.projectId=projectId;this.oversightPublicKey=oversightPublicKey;this.ownerPublicKey=ownerPublicKey;}
  evaluate(envelope){if(!envelope||envelope.schemaVersion!==1||envelope.projectId!==this.projectId||!['STOP','CLEAR'].includes(envelope.decision)||!Number.isFinite(Date.parse(envelope.issuedAt))||typeof envelope.reason!=='string'||!envelope.reason.trim())throw new Error('Oversight decision schema or project identity is invalid.');const payload={schemaVersion:1,projectId:envelope.projectId,decision:envelope.decision,reason:envelope.reason,issuedAt:envelope.issuedAt,stateSha256:envelope.stateSha256};if(!/^[a-f0-9]{64}$/.test(payload.stateSha256||''))throw new Error('Oversight decision must bind the exact organism state hash.');verify(envelope.oversightSignature,payload,this.oversightPublicKey,'Oversight');if(envelope.decision==='CLEAR')verify(envelope.ownerSignature,payload,this.ownerPublicKey,'Owner authorization');return{decision:envelope.decision,reason:envelope.reason,issuedAt:envelope.issuedAt,stateSha256:envelope.stateSha256,oversightVerified:true,ownerVerified:envelope.decision==='CLEAR'};}
}
module.exports={ExternalOversightReflex,canonical};

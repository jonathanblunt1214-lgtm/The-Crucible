const crypto=require('node:crypto');
const fs=require('node:fs');

const REQUIRED=Object.freeze(['schemaVersion','projectId','workloadSha256','issuedAt','expiresAt','enabled']);
function canonical(value){return JSON.stringify(Object.fromEntries(Object.keys(value).sort().map((key)=>[key,value[key]])));}
function validatePayload(payload,{projectId,workloadSha256,now,maxLifetimeMs}){
  if(!payload||Object.keys(payload).sort().join(',')!==[...REQUIRED].sort().join(','))throw new Error('GPU permit schema is not allow-listed.');
  if(payload.schemaVersion!==1||payload.enabled!==true)throw new Error('GPU permit is not enabled.');
  if(payload.projectId!==projectId||payload.workloadSha256!==workloadSha256)throw new Error('GPU permit project or workload binding failed.');
  const issued=Date.parse(payload.issuedAt),expires=Date.parse(payload.expiresAt),current=Date.parse(now);
  if(!Number.isFinite(issued)||!Number.isFinite(expires)||expires<=issued||expires-issued>maxLifetimeMs||current<issued||current>=expires)throw new Error('GPU permit lifetime is invalid or inactive.');
}
class OfflineGpuGate{
  constructor({projectId,ownerPublicKey,permitFile,hardStopFile,now=()=>new Date().toISOString(),maxLifetimeMs=60*60*1000}){if(!projectId||!ownerPublicKey||!permitFile||!hardStopFile)throw new Error('Offline GPU gate requires project, owner public key, permit, and hard-stop paths.');this.projectId=projectId;this.publicKey=ownerPublicKey?.type==='public'?ownerPublicKey:crypto.createPublicKey(ownerPublicKey);this.permitFile=permitFile;this.hardStopFile=hardStopFile;this.now=now;this.maxLifetimeMs=maxLifetimeMs;}
  status(workloadSha256){try{if(fs.existsSync(this.hardStopFile))throw new Error('Owner air-gapped GPU hard stop is active.');if(!fs.existsSync(this.permitFile))throw new Error('Owner GPU permit is absent.');const envelope=JSON.parse(fs.readFileSync(this.permitFile,'utf8'));if(!envelope||Object.keys(envelope).sort().join(',')!=='payload,signature')throw new Error('GPU permit envelope is invalid.');validatePayload(envelope.payload,{projectId:this.projectId,workloadSha256,now:this.now(),maxLifetimeMs:this.maxLifetimeMs});const valid=crypto.verify(null,Buffer.from(canonical(envelope.payload)),this.publicKey,Buffer.from(envelope.signature,'base64'));if(!valid)throw new Error('Owner GPU permit signature is invalid.');return{state:'enabled',projectId:this.projectId,workloadSha256,expiresAt:envelope.payload.expiresAt};}catch(error){return{state:'inhibited',projectId:this.projectId,workloadSha256,reason:error.message};}}
  assertAllowed(workloadSha256){const result=this.status(workloadSha256);if(result.state!=='enabled')throw new Error(result.reason);return result;}
}
module.exports={REQUIRED,canonical,validatePayload,OfflineGpuGate};

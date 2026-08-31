'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');

const MAGIC = 'CRUCIBLE-SOURCE-BUNDLE-V1';
const TAG_BYTES = 16;

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try { let count; while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count)); }
  finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

function validateIdentity(projectId, repository, ref) {
  if (projectId !== `github:${repository}`) throw new Error('Source bundle project identity does not match the repository.');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '')) throw new Error('Repository identity is invalid.');
  if (ref !== 'refs/heads/development') throw new Error('Source bundle transport is development-only.');
}

function sourceFilename(source) {
  const digest = String(source.contentSha256 || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(`Source ${source.id || '<unknown>'} has no valid content hash.`);
  const extension = path.extname(source.durablePath || source.originalName || '') || (source.mediaType === 'application/pdf' ? '.pdf' : '.bin');
  return `${digest}${extension.toLowerCase()}`;
}

function stage({ sourceRoot, learningFile, stagingRoot, repository, ref }) {
  const queueFile = path.join(sourceRoot, 'source-queue.json');
  const queue = JSON.parse(fs.readFileSync(queueFile, 'utf8'));
  validateIdentity(queue.projectId, repository, ref);
  fs.mkdirSync(path.join(stagingRoot, 'sources'), { recursive:true });
  const records = [...queue.documents, ...queue.links];
  const copied = new Map();
  for (const source of records) {
    if (!source.durablePath || !fs.existsSync(source.durablePath)) continue;
    const filename = sourceFilename(source);
    const destination = path.join(stagingRoot, 'sources', filename);
    if (!copied.has(filename)) {
      if (sha256File(source.durablePath) !== source.contentSha256.toLowerCase()) throw new Error(`Source hash mismatch for ${source.id}.`);
      fs.copyFileSync(source.durablePath, destination, fs.constants.COPYFILE_EXCL);
      copied.set(filename, true);
    }
    source.durablePath = `sources/${filename}`;
    delete source.originalPath;
  }
  fs.writeFileSync(path.join(stagingRoot, 'source-queue.json'), `${JSON.stringify(queue, null, 2)}\n`, { flag:'wx', mode:0o600 });
  const learningName = path.basename(learningFile);
  fs.copyFileSync(learningFile, path.join(stagingRoot, learningName), fs.constants.COPYFILE_EXCL);
  const manifest = {
    schemaVersion:1, projectId:queue.projectId, repository, ref,
    createdAt:new Date().toISOString(), queueSha256:sha256File(path.join(stagingRoot, 'source-queue.json')),
    learningFile:learningName, learningSha256:sha256File(path.join(stagingRoot, learningName)),
    sourceFiles:[...copied.keys()].sort().map((name)=>({name,sha256:sha256File(path.join(stagingRoot,'sources',name)),bytes:fs.statSync(path.join(stagingRoot,'sources',name)).size})),
  };
  fs.writeFileSync(path.join(stagingRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag:'wx', mode:0o600 });
  return manifest;
}

function keyFromEnvironment() {
  const value = process.env.CRUCIBLE_SOURCE_BUNDLE_KEY || '';
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error('CRUCIBLE_SOURCE_BUNDLE_KEY must be a base64-encoded 32-byte key.');
  return key;
}

async function encrypt({ input, output, projectId, repository, ref }) {
  validateIdentity(projectId, repository, ref);
  const iv = crypto.randomBytes(12);
  const header = { magic:MAGIC, schemaVersion:1, algorithm:'aes-256-gcm', projectId, repository, ref, iv:iv.toString('base64'), plaintextSha256:sha256File(input), plaintextBytes:fs.statSync(input).size };
  const encoded = Buffer.from(`${JSON.stringify(header)}\n`);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFromEnvironment(), iv); cipher.setAAD(encoded);
  const handle = fs.openSync(output, 'wx', 0o600); fs.writeSync(handle, encoded); fs.closeSync(handle);
  await pipeline(fs.createReadStream(input), cipher, fs.createWriteStream(output, { flags:'a', mode:0o600 }));
  fs.appendFileSync(output, cipher.getAuthTag());
  return header;
}

async function decrypt({ input, output, repository, ref }) {
  const fd = fs.openSync(input, 'r'); const probe = Buffer.alloc(8192); const count = fs.readSync(fd, probe, 0, probe.length, 0); fs.closeSync(fd);
  const newline = probe.subarray(0, count).indexOf(10); if (newline < 0) throw new Error('Encrypted source bundle header is missing.');
  const encoded = probe.subarray(0, newline + 1); const header = JSON.parse(encoded.toString('utf8'));
  if (header.magic !== MAGIC || header.algorithm !== 'aes-256-gcm') throw new Error('Encrypted source bundle format is invalid.');
  validateIdentity(header.projectId, repository, ref);
  const size = fs.statSync(input).size; if (size <= encoded.length + TAG_BYTES) throw new Error('Encrypted source bundle is truncated.');
  const tag = Buffer.alloc(TAG_BYTES); const tagFd = fs.openSync(input, 'r'); fs.readSync(tagFd, tag, 0, TAG_BYTES, size - TAG_BYTES); fs.closeSync(tagFd);
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyFromEnvironment(), Buffer.from(header.iv, 'base64')); decipher.setAAD(encoded); decipher.setAuthTag(tag);
  await pipeline(fs.createReadStream(input,{start:encoded.length,end:size-TAG_BYTES-1}),decipher,fs.createWriteStream(output,{flags:'wx',mode:0o600}));
  if (fs.statSync(output).size !== header.plaintextBytes || sha256File(output) !== header.plaintextSha256) throw new Error('Decrypted source bundle hash or size does not match its authenticated header.');
  return header;
}

function verifyRestored({ root, repository, ref, reportFile }) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
  validateIdentity(manifest.projectId, repository, ref);
  if (sha256File(path.join(root,'source-queue.json')) !== manifest.queueSha256) throw new Error('Restored queue hash mismatch.');
  if (sha256File(path.join(root,manifest.learningFile)) !== manifest.learningSha256) throw new Error('Restored learning-store hash mismatch.');
  for (const source of manifest.sourceFiles) if (sha256File(path.join(root,'sources',source.name)) !== source.sha256) throw new Error(`Restored source hash mismatch: ${source.name}`);
  const queue=JSON.parse(fs.readFileSync(path.join(root,'source-queue.json'),'utf8'));
  const states={}; for(const item of [...queue.documents,...queue.links]) states[item.state]=(states[item.state]||0)+1;
  const report={schemaVersion:1,projectId:manifest.projectId,repository,ref,verifiedAt:new Date().toISOString(),queueSha256:manifest.queueSha256,learningSha256:manifest.learningSha256,sourceFiles:manifest.sourceFiles.length,sourceBytes:manifest.sourceFiles.reduce((sum,item)=>sum+item.bytes,0),documents:queue.documents.length,links:queue.links.length,states,plaintextRetained:false,authorizesPromotion:false};
  fs.mkdirSync(path.dirname(reportFile),{recursive:true}); fs.writeFileSync(reportFile,`${JSON.stringify(report,null,2)}\n`,{mode:0o600}); return report;
}

function splitEncrypted({ input, outputRoot, maximumBytes = 80 * 1024 * 1024 }) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1024 || maximumBytes >= 100 * 1024 * 1024) throw new Error('Encrypted chunk size must stay between 1 KiB and less than 100 MiB.');
  fs.mkdirSync(outputRoot,{recursive:true}); const fd=fs.openSync(input,'r'); const chunks=[]; let offset=0,index=0;
  try { while(offset<fs.statSync(input).size){const length=Math.min(maximumBytes,fs.statSync(input).size-offset);const buffer=Buffer.allocUnsafe(length);fs.readSync(fd,buffer,0,length,offset);const name=`source-bundle.part-${String(index).padStart(4,'0')}.enc`;const file=path.join(outputRoot,name);fs.writeFileSync(file,buffer,{flag:'wx',mode:0o600});chunks.push({name,bytes:length,sha256:sha256File(file)});offset+=length;index+=1;} }
  finally{fs.closeSync(fd);}
  const manifest={schemaVersion:1,format:MAGIC,encryptedSha256:sha256File(input),encryptedBytes:fs.statSync(input).size,chunks};fs.writeFileSync(path.join(outputRoot,'encrypted-chunks.json'),`${JSON.stringify(manifest,null,2)}\n`,{flag:'wx',mode:0o600});return manifest;
}

function joinEncrypted({ inputRoot, output }) {
  const manifest=JSON.parse(fs.readFileSync(path.join(inputRoot,'encrypted-chunks.json'),'utf8'));const handle=fs.openSync(output,'wx',0o600);
  try{for(const chunk of manifest.chunks){const file=path.join(inputRoot,chunk.name);if(fs.statSync(file).size!==chunk.bytes||sha256File(file)!==chunk.sha256)throw new Error(`Encrypted chunk failed custody verification: ${chunk.name}`);fs.writeSync(handle,fs.readFileSync(file));}}
  finally{fs.closeSync(handle);}
  if(fs.statSync(output).size!==manifest.encryptedBytes||sha256File(output)!==manifest.encryptedSha256)throw new Error('Reassembled encrypted bundle does not match its manifest.');return manifest;
}

async function main() {
  const [command,...args]=process.argv.slice(2); const value=(name)=>{const i=args.indexOf(name);if(i<0||!args[i+1])throw new Error(`${name} is required.`);return args[i+1];};
  if(command==='stage') return console.log(JSON.stringify(stage({sourceRoot:value('--source-root'),learningFile:value('--learning-file'),stagingRoot:value('--staging-root'),repository:value('--repository'),ref:value('--ref')})));
  if(command==='encrypt') return console.log(JSON.stringify(await encrypt({input:value('--input'),output:value('--output'),projectId:value('--project-id'),repository:value('--repository'),ref:value('--ref')})));
  if(command==='decrypt') return console.log(JSON.stringify(await decrypt({input:value('--input'),output:value('--output'),repository:value('--repository'),ref:value('--ref')})));
  if(command==='verify') return console.log(JSON.stringify(verifyRestored({root:value('--root'),repository:value('--repository'),ref:value('--ref'),reportFile:value('--report')})));
  if(command==='split') return console.log(JSON.stringify(splitEncrypted({input:value('--input'),outputRoot:value('--output-root')})));
  if(command==='join') return console.log(JSON.stringify(joinEncrypted({inputRoot:value('--input-root'),output:value('--output')})));
  throw new Error('Usage: hostedSourceBundle.js stage|encrypt|decrypt|verify|split|join ...');
}

if(require.main===module)main().catch((error)=>{console.error(`[The Crucible] Hosted source bundle failed: ${error.message}`);process.exitCode=1;});
module.exports={MAGIC,sha256File,stage,encrypt,decrypt,verifyRestored,splitEncrypted,joinEncrypted};

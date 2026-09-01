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

// The keys a restore may be read with, in the order they are tried. Order is a governance
// statement rather than a convenience: material that came through oversight's information gate is
// preferred over the raw intake bundle, and the run records which one actually supplied the
// corpus, because "vetted" and "not vetted" are different provenance and must never be collapsed
// into "the corpus loaded".
// A key ending in _PREVIOUS is the outgoing key of its family, set only while a rotation is in
// flight. Encryption never uses one; only a read does, so a rotation cannot strand a corpus that
// is already encrypted under the key being retired.
const KEY_VARIABLES = Object.freeze([
  // Oversight's vetted, re-encrypted publication: material that passed the information gate.
  'CRUCIBLE_VETTED_BUNDLE_KEY',
  'CRUCIBLE_VETTED_BUNDLE_KEY_PREVIOUS',
  // The raw intake bundle's key. The hosted proof is never given this: it reads vetted custody
  // only. It stays here for the staging side, which is what writes the intake bundle.
  'CRUCIBLE_SOURCE_BUNDLE_KEY',
  'CRUCIBLE_SOURCE_BUNDLE_KEY_PREVIOUS',
]);
const ENCRYPTION_KEY_VARIABLE = 'CRUCIBLE_SOURCE_BUNDLE_KEY';

function keyFromEnvironment(name = ENCRYPTION_KEY_VARIABLE) {
  const value = process.env[name] || '';
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error(`${name} must be a base64-encoded 32-byte key.`);
  return key;
}

function candidateKeys(names = KEY_VARIABLES) {
  const present = [], absent = [];
  for (const name of names) {
    if (!(process.env[name] || '')) { absent.push(name); continue; }
    present.push({ name, key: keyFromEnvironment(name) });
  }
  if (!present.length) throw new Error(`No source-bundle key is set. One of ${names.join(', ')} must hold a base64-encoded 32-byte key.`);
  return { present, absent };
}

// Which gate the corpus came through. It is derived from the key that opened the bundle rather
// than declared alongside it, because only oversight can write a bundle the vetted key reads, and
// a provenance label that travels separately from the evidence is a label anyone can attach.
const provenanceFor = (keyName) => (String(keyName).startsWith('CRUCIBLE_VETTED_BUNDLE_KEY') ? 'oversight-vetted' : 'raw-intake');

// The header is written in front of the ciphertext and is readable without any key. That is what
// makes a failed decryption diagnosable at all: it says which project, repository and ref the
// bundle was written for, and what the plaintext should hash to.
function readHeader(input) {
  const fd = fs.openSync(input, 'r'); const probe = Buffer.alloc(8192); const count = fs.readSync(fd, probe, 0, probe.length, 0); fs.closeSync(fd);
  const newline = probe.subarray(0, count).indexOf(10); if (newline < 0) throw new Error('Encrypted source bundle header is missing.');
  const encoded = probe.subarray(0, newline + 1); const header = JSON.parse(encoded.toString('utf8'));
  if (header.magic !== MAGIC || header.algorithm !== 'aes-256-gcm') throw new Error('Encrypted source bundle format is invalid.');
  return { header, encoded };
}

async function encrypt({ input, output, projectId, repository, ref }) {
  validateIdentity(projectId, repository, ref);
  const iv = crypto.randomBytes(12);
  const header = { magic:MAGIC, schemaVersion:1, algorithm:'aes-256-gcm', projectId, repository, ref, iv:iv.toString('base64'), plaintextSha256:sha256File(input), plaintextBytes:fs.statSync(input).size };
  const encoded = Buffer.from(`${JSON.stringify(header)}\n`);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFromEnvironment(ENCRYPTION_KEY_VARIABLE), iv); cipher.setAAD(encoded);
  const handle = fs.openSync(output, 'wx', 0o600); fs.writeSync(handle, encoded); fs.closeSync(handle);
  await pipeline(fs.createReadStream(input), cipher, fs.createWriteStream(output, { flags:'a', mode:0o600 }));
  fs.appendFileSync(output, cipher.getAuthTag());
  return header;
}

async function decrypt({ input, output, repository, ref, keyNames = KEY_VARIABLES }) {
  const { header, encoded } = readHeader(input);
  validateIdentity(header.projectId, repository, ref);
  const size = fs.statSync(input).size; if (size <= encoded.length + TAG_BYTES) throw new Error('Encrypted source bundle is truncated.');
  const tag = Buffer.alloc(TAG_BYTES); const tagFd = fs.openSync(input, 'r'); fs.readSync(tagFd, tag, 0, TAG_BYTES, size - TAG_BYTES); fs.closeSync(tagFd);
  const { present, absent } = candidateKeys(keyNames);
  const attempts = [];
  for (const candidate of present) {
    const staging = `${output}.${process.pid}.${crypto.randomUUID()}.attempt`;
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', candidate.key, Buffer.from(header.iv, 'base64')); decipher.setAAD(encoded); decipher.setAuthTag(tag);
      await pipeline(fs.createReadStream(input,{start:encoded.length,end:size-TAG_BYTES-1}),decipher,fs.createWriteStream(staging,{flags:'wx',mode:0o600}));
      if (fs.statSync(staging).size !== header.plaintextBytes || sha256File(staging) !== header.plaintextSha256) throw new Error('decrypted content does not match the size and hash its header commits to');
      fs.renameSync(staging, output);
      return { ...header, decryptedWith: candidate.name, provenance: provenanceFor(candidate.name), keysTried: attempts.map((item) => item.name).concat(candidate.name) };
    } catch (error) {
      // A failed attempt leaves nothing behind: a half-written plaintext is still plaintext.
      try { fs.rmSync(staging, { force: true }); } catch { /* the staging file was never created */ }
      attempts.push({ name: candidate.name, message: String(error.message || error) });
    }
  }
  // What follows is the whole point of trying more than one key: a run that dies here should say
  // what is actually wrong. AES-GCM cannot distinguish a wrong key from altered ciphertext - both
  // fail authentication identically - so this states both readings rather than picking one, and
  // gives the header, which needs no key to read, as the evidence for judging between them.
  throw new Error([
    `No configured key could authenticate the encrypted source bundle at ${input}.`,
    `Its header, which is readable without any key, says it was written for project ${header.projectId} at ${header.repository}@${header.ref}: ${header.plaintextBytes} plaintext bytes, sha256 ${header.plaintextSha256}.`,
    `Tried in order: ${attempts.map((item) => item.name).join(', ')}.${absent.length ? ` Not set: ${absent.join(', ')}.` : ''}`,
    'AES-GCM fails the same way for a wrong key and for altered ciphertext, so this is one of two things. If a key was rotated, this repository is holding a stale secret and no longer has the key the bundle was written with: set the current key, and keep the outgoing one in CRUCIBLE_SOURCE_BUNDLE_KEY_PREVIOUS while both are in circulation. If no key was rotated, treat the ciphertext as suspect and do not retry with more keys.',
    'A key cannot be recovered from the ciphertext. If no copy of the key that wrote this bundle exists anywhere, the corpus has to be re-encrypted under a new one.',
  ].join(' '));
}

function verifyRestored({ root, repository, ref, reportFile, provenance = 'raw-intake' }) {
  if (!['oversight-vetted','raw-intake'].includes(provenance)) throw new Error(`Corpus provenance must be recorded as oversight-vetted or raw-intake, not ${provenance}.`);
  const manifest = JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
  validateIdentity(manifest.projectId, repository, ref);
  if (sha256File(path.join(root,'source-queue.json')) !== manifest.queueSha256) throw new Error('Restored queue hash mismatch.');
  if (sha256File(path.join(root,manifest.learningFile)) !== manifest.learningSha256) throw new Error('Restored learning-store hash mismatch.');
  for (const source of manifest.sourceFiles) if (sha256File(path.join(root,'sources',source.name)) !== source.sha256) throw new Error(`Restored source hash mismatch: ${source.name}`);
  const queue=JSON.parse(fs.readFileSync(path.join(root,'source-queue.json'),'utf8'));
  const states={}; for(const item of [...queue.documents,...queue.links]) states[item.state]=(states[item.state]||0)+1;
  const report={schemaVersion:1,projectId:manifest.projectId,repository,ref,verifiedAt:new Date().toISOString(),corpusProvenance:provenance,vetted:provenance==='oversight-vetted',queueSha256:manifest.queueSha256,learningSha256:manifest.learningSha256,sourceFiles:manifest.sourceFiles.length,sourceBytes:manifest.sourceFiles.reduce((sum,item)=>sum+item.bytes,0),documents:queue.documents.length,links:queue.links.length,states,plaintextRetained:false,authorizesPromotion:false};
  fs.mkdirSync(path.dirname(reportFile),{recursive:true}); fs.writeFileSync(reportFile,`${JSON.stringify(report,null,2)}\n`,{mode:0o600}); return report;
}

function hydrateRestored({ root, repository, ref }) {
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));validateIdentity(manifest.projectId,repository,ref);
  const queueFile=path.join(root,'source-queue.json');const queue=JSON.parse(fs.readFileSync(queueFile,'utf8'));validateIdentity(queue.projectId,repository,ref);
  for(const source of [...queue.documents,...queue.links]){
    if(!source.durablePath)continue;
    const relative=source.durablePath.replaceAll('\\','/');if(path.isAbsolute(relative)||!relative.startsWith('sources/'))throw new Error(`Restored source path escapes custody: ${source.id}.`);
    const absolute=path.resolve(root,relative);if(!absolute.startsWith(`${path.resolve(root)}${path.sep}`)||!fs.existsSync(absolute))throw new Error(`Restored source content is missing: ${source.id}.`);
    if(sha256File(absolute)!==String(source.contentSha256).toLowerCase())throw new Error(`Restored source hash mismatch: ${source.id}.`);source.durablePath=absolute;
  }
  const temporary=`${queueFile}.${process.pid}.${crypto.randomUUID()}.tmp`;fs.writeFileSync(temporary,`${JSON.stringify(queue,null,2)}\n`,{flag:'wx',mode:0o600});fs.renameSync(temporary,queueFile);
  return {projectId:queue.projectId,queueFile,learningRoot:path.resolve(root),sources:[...queue.documents,...queue.links].filter((item)=>item.durablePath).length};
}

function restageRestored({ root, repository, ref }) {
  const manifestFile=path.join(root,'manifest.json');const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));validateIdentity(manifest.projectId,repository,ref);
  const queueFile=path.join(root,'source-queue.json');const queue=JSON.parse(fs.readFileSync(queueFile,'utf8'));validateIdentity(queue.projectId,repository,ref);
  for(const source of [...queue.documents,...queue.links]){
    if(!source.durablePath)continue;const absolute=path.resolve(source.durablePath);const sourcesRoot=path.resolve(root,'sources');
    if(!absolute.startsWith(`${sourcesRoot}${path.sep}`)||!fs.existsSync(absolute))throw new Error(`Worker source path escapes encrypted custody: ${source.id}.`);
    if(sha256File(absolute)!==String(source.contentSha256).toLowerCase())throw new Error(`Worker changed immutable source content: ${source.id}.`);source.durablePath=`sources/${path.basename(absolute)}`;delete source.originalPath;
  }
  const temporary=`${queueFile}.${process.pid}.${crypto.randomUUID()}.tmp`;fs.writeFileSync(temporary,`${JSON.stringify(queue,null,2)}\n`,{flag:'wx',mode:0o600});fs.renameSync(temporary,queueFile);
  manifest.updatedAt=new Date().toISOString();manifest.queueSha256=sha256File(queueFile);manifest.learningSha256=sha256File(path.join(root,manifest.learningFile));
  const manifestTemporary=`${manifestFile}.${process.pid}.${crypto.randomUUID()}.tmp`;fs.writeFileSync(manifestTemporary,`${JSON.stringify(manifest,null,2)}\n`,{flag:'wx',mode:0o600});fs.renameSync(manifestTemporary,manifestFile);return manifest;
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
  const optional=(name)=>{const i=args.indexOf(name);return i<0||!args[i+1]?null:args[i+1];};
  if(command==='header') return console.log(JSON.stringify(readHeader(value('--input')).header));
  if(command==='decrypt'){const keys=optional('--keys');return console.log(JSON.stringify(await decrypt({input:value('--input'),output:value('--output'),repository:value('--repository'),ref:value('--ref'),...(keys?{keyNames:keys.split(',').map((item)=>item.trim()).filter(Boolean)}:{})})));}
  if(command==='verify') return console.log(JSON.stringify(verifyRestored({root:value('--root'),repository:value('--repository'),ref:value('--ref'),reportFile:value('--report'),...(optional('--provenance')?{provenance:optional('--provenance')}:{})})));
  if(command==='hydrate') return console.log(JSON.stringify(hydrateRestored({root:value('--root'),repository:value('--repository'),ref:value('--ref')})));
  if(command==='restage') return console.log(JSON.stringify(restageRestored({root:value('--root'),repository:value('--repository'),ref:value('--ref')})));
  if(command==='split') return console.log(JSON.stringify(splitEncrypted({input:value('--input'),outputRoot:value('--output-root')})));
  if(command==='join') return console.log(JSON.stringify(joinEncrypted({inputRoot:value('--input-root'),output:value('--output')})));
  throw new Error('Usage: hostedSourceBundle.js stage|encrypt|decrypt|verify|hydrate|restage|split|join|header ...');
}

if(require.main===module)main().catch((error)=>{console.error(`[The Crucible] Hosted source bundle failed: ${error.message}`);process.exitCode=1;});
module.exports={MAGIC,KEY_VARIABLES,ENCRYPTION_KEY_VARIABLE,keyFromEnvironment,candidateKeys,readHeader,provenanceFor,sha256File,stage,encrypt,decrypt,verifyRestored,hydrateRestored,restageRestored,splitEncrypted,joinEncrypted};

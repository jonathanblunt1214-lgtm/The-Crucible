'use strict';
const test=require('node:test'); const assert=require('node:assert/strict'); const crypto=require('node:crypto'); const fs=require('node:fs'); const os=require('node:os'); const path=require('node:path');
const {stage,encrypt,decrypt,verifyRestored,hydrateRestored,restageRestored,splitEncrypted,joinEncrypted}=require('../src/hostedSourceBundle');
test('stages, encrypts, restores, and verifies a project-bound source queue without local paths',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'crucible-source-bundle-')); const sourceRoot=path.join(root,'local','sources'); const staging=path.join(root,'stage'); fs.mkdirSync(sourceRoot,{recursive:true});
  const content=Buffer.from('bounded untrusted source'); const digest=crypto.createHash('sha256').update(content).digest('hex'); const local=path.join(sourceRoot,`${digest}.html`); fs.writeFileSync(local,content);
  const projectId='github:owner/repo'; const queue={schemaVersion:1,projectId,documents:[],links:[{id:'source-1',durablePath:local,originalPath:'C:/private/source.html',contentSha256:digest,state:'claim-extraction-forced-pending'}]}; fs.writeFileSync(path.join(sourceRoot,'source-queue.json'),JSON.stringify(queue)); const learning=path.join(root,'learning.json'); fs.writeFileSync(learning,'{}');
  const manifest=stage({sourceRoot,learningFile:learning,stagingRoot:staging,repository:'owner/repo',ref:'refs/heads/development'}); assert.equal(manifest.sourceFiles.length,1); const stagedQueue=fs.readFileSync(path.join(staging,'source-queue.json'),'utf8'); assert.doesNotMatch(stagedQueue,/C:\/private/); assert.match(stagedQueue,/sources\//);
  const archive=path.join(root,'archive.bin'); fs.writeFileSync(archive,Buffer.from('archive payload'.repeat(300))); const encrypted=path.join(root,'bundle.enc'); const restoredArchive=path.join(root,'restored.bin'); process.env.CRUCIBLE_SOURCE_BUNDLE_KEY=crypto.randomBytes(32).toString('base64');
  await encrypt({input:archive,output:encrypted,projectId,repository:'owner/repo',ref:'refs/heads/development'}); assert.doesNotMatch(fs.readFileSync(encrypted).toString('latin1'),/archive payload/); await decrypt({input:encrypted,output:restoredArchive,repository:'owner/repo',ref:'refs/heads/development'}); assert.deepEqual(fs.readFileSync(restoredArchive),fs.readFileSync(archive));
  const report=verifyRestored({root:staging,repository:'owner/repo',ref:'refs/heads/development',reportFile:path.join(root,'report.json')}); assert.equal(report.sourceFiles,1); assert.equal(report.plaintextRetained,false); assert.equal(report.authorizesPromotion,false);
  const hydrated=hydrateRestored({root:staging,repository:'owner/repo',ref:'refs/heads/development'});assert.equal(hydrated.sources,1);assert.equal(path.isAbsolute(JSON.parse(fs.readFileSync(hydrated.queueFile)).links[0].durablePath),true);
  const restaged=restageRestored({root:staging,repository:'owner/repo',ref:'refs/heads/development'});assert.equal(restaged.queueSha256,crypto.createHash('sha256').update(fs.readFileSync(hydrated.queueFile)).digest('hex'));assert.match(JSON.parse(fs.readFileSync(hydrated.queueFile)).links[0].durablePath,/^sources\//);
  const chunks=path.join(root,'chunks'); const chunkManifest=splitEncrypted({input:encrypted,outputRoot:chunks,maximumBytes:1024}); assert.ok(chunkManifest.chunks.length>1); const joined=path.join(root,'joined.enc'); joinEncrypted({inputRoot:chunks,output:joined}); assert.deepEqual(fs.readFileSync(joined),fs.readFileSync(encrypted));
});

// The failure the hosted runs have actually been dying on since a key rotation: the ciphertext is
// intact and addressed to this project, and no configured key can open it.
const {KEY_VARIABLES,readHeader,candidateKeys,provenanceFor}=require('../src/hostedSourceBundle');
function bundleFixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'crucible-key-rotation-'));
  const plaintext=path.join(root,'corpus.tar.gz'); fs.writeFileSync(plaintext,Buffer.from('the real corpus'.repeat(200)));
  return {root,plaintext,encrypted:path.join(root,'bundle.enc'),identity:{repository:'owner/repo',ref:'refs/heads/development'},projectId:'github:owner/repo'};
}
function clearKeys(){for(const name of KEY_VARIABLES)delete process.env[name];}

test('a rotated key is survivable: the outgoing key still opens a bundle already written under it',async(t)=>{
  const f=bundleFixture(); t.after(clearKeys); clearKeys();
  const original=crypto.randomBytes(32).toString('base64');
  process.env.CRUCIBLE_SOURCE_BUNDLE_KEY=original;
  await encrypt({input:f.plaintext,output:f.encrypted,projectId:f.projectId,...f.identity});
  // The rotation: the intake secret now holds a different key entirely.
  process.env.CRUCIBLE_SOURCE_BUNDLE_KEY=crypto.randomBytes(32).toString('base64');
  await assert.rejects(decrypt({input:f.encrypted,output:path.join(f.root,'a.tar.gz'),...f.identity}),/No configured key could authenticate/);
  process.env.CRUCIBLE_SOURCE_BUNDLE_KEY_PREVIOUS=original;
  const result=await decrypt({input:f.encrypted,output:path.join(f.root,'b.tar.gz'),...f.identity});
  assert.equal(result.decryptedWith,'CRUCIBLE_SOURCE_BUNDLE_KEY_PREVIOUS');
  assert.deepEqual(result.keysTried,['CRUCIBLE_SOURCE_BUNDLE_KEY','CRUCIBLE_SOURCE_BUNDLE_KEY_PREVIOUS']);
  assert.deepEqual(fs.readFileSync(path.join(f.root,'b.tar.gz')),fs.readFileSync(f.plaintext));
  assert.equal(fs.existsSync(path.join(f.root,'a.tar.gz')),false,'a failed attempt leaves no half-written plaintext behind');
});

test('when no key opens the bundle the run says what is wrong, from the header, which needs no key',async(t)=>{
  const f=bundleFixture(); t.after(clearKeys); clearKeys();
  process.env.CRUCIBLE_SOURCE_BUNDLE_KEY=crypto.randomBytes(32).toString('base64');
  await encrypt({input:f.plaintext,output:f.encrypted,projectId:f.projectId,...f.identity});
  const {header}=readHeader(f.encrypted);
  process.env.CRUCIBLE_SOURCE_BUNDLE_KEY=crypto.randomBytes(32).toString('base64');
  await assert.rejects(decrypt({input:f.encrypted,output:path.join(f.root,'out.tar.gz'),...f.identity}),(error)=>{
    assert.match(error.message,new RegExp(`written for project ${f.projectId.replace('/','\\/')} at owner\\/repo@refs\\/heads\\/development`));
    assert.match(error.message,new RegExp(header.plaintextSha256),'the header names the plaintext the bundle should produce');
    assert.match(error.message,/Tried in order: CRUCIBLE_SOURCE_BUNDLE_KEY\./);
    assert.match(error.message,/Not set: CRUCIBLE_VETTED_BUNDLE_KEY, CRUCIBLE_SOURCE_BUNDLE_KEY_PREVIOUS\./);
    assert.match(error.message,/fails the same way for a wrong key and for altered ciphertext/,'a wrong key and tampering are not distinguished, and the message does not pretend otherwise');
    assert.match(error.message,/cannot be recovered from the ciphertext/);
    return true;
  });
  clearKeys();
  await assert.rejects(decrypt({input:f.encrypted,output:path.join(f.root,'none.tar.gz'),...f.identity}),/No source-bundle key is set/);
});

test('the vetted bundle is preferred over raw intake, and which gate the corpus came through is recorded',async(t)=>{
  const f=bundleFixture(); t.after(clearKeys); clearKeys();
  const intake=crypto.randomBytes(32).toString('base64');
  process.env.CRUCIBLE_SOURCE_BUNDLE_KEY=intake;
  await encrypt({input:f.plaintext,output:f.encrypted,projectId:f.projectId,...f.identity});
  const raw=await decrypt({input:f.encrypted,output:path.join(f.root,'raw.tar.gz'),...f.identity});
  assert.equal(raw.provenance,'raw-intake');
  // Oversight's publication: the same corpus re-encrypted under the key only it can write with.
  const vetted=path.join(f.root,'vetted.enc');
  process.env.CRUCIBLE_SOURCE_BUNDLE_KEY=crypto.randomBytes(32).toString('base64');
  await encrypt({input:f.plaintext,output:vetted,projectId:f.projectId,...f.identity});
  process.env.CRUCIBLE_VETTED_BUNDLE_KEY=process.env.CRUCIBLE_SOURCE_BUNDLE_KEY;
  process.env.CRUCIBLE_SOURCE_BUNDLE_KEY=intake;
  const opened=await decrypt({input:vetted,output:path.join(f.root,'vetted.tar.gz'),...f.identity});
  assert.equal(opened.decryptedWith,'CRUCIBLE_VETTED_BUNDLE_KEY','the vetted key is tried first');
  assert.equal(opened.provenance,'oversight-vetted');
  assert.equal(candidateKeys().present.length,2);
  assert.equal(provenanceFor('CRUCIBLE_SOURCE_BUNDLE_KEY_PREVIOUS'),'raw-intake');
});

test('the custody report records which gate the corpus came through, and refuses an invented label',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'crucible-provenance-')); const sourceRoot=path.join(root,'sources'); fs.mkdirSync(sourceRoot,{recursive:true});
  const staging=path.join(root,'stage'); const content=Buffer.from('bounded untrusted source'); const digest=crypto.createHash('sha256').update(content).digest('hex');
  fs.writeFileSync(path.join(sourceRoot,`${digest}.html`),content);
  fs.writeFileSync(path.join(sourceRoot,'source-queue.json'),JSON.stringify({schemaVersion:1,projectId:'github:owner/repo',documents:[],links:[{id:'s1',durablePath:path.join(sourceRoot,`${digest}.html`),contentSha256:digest,state:'pending'}]}));
  const learning=path.join(root,'learning.json'); fs.writeFileSync(learning,'{}');
  stage({sourceRoot,learningFile:learning,stagingRoot:staging,repository:'owner/repo',ref:'refs/heads/development'});
  const identity={root:staging,repository:'owner/repo',ref:'refs/heads/development'};
  assert.equal(verifyRestored({...identity,reportFile:path.join(root,'r1.json')}).corpusProvenance,'raw-intake','unvetted is the default, because it is the weaker claim');
  const report=verifyRestored({...identity,reportFile:path.join(root,'r2.json'),provenance:'oversight-vetted'});
  assert.equal(report.vetted,true);
  assert.equal(report.authorizesPromotion,false,'passing the information gate is not authority to promote anything');
  assert.throws(()=>verifyRestored({...identity,reportFile:path.join(root,'r3.json'),provenance:'trust-me'}),/must be recorded as oversight-vetted or raw-intake/);
});

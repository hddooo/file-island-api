'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const C=require('./image-build-contract.cjs'),handoff=require('./check-image-cd-handoff.cjs');
const commit='a'.repeat(40);
function env(){return {GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:C.REPOSITORY,GITHUB_SHA:commit,GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_WORKFLOW_REF:C.REPOSITORY+'/'+C.WORKFLOW+'@refs/heads/main',GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1'};}
function tar(files){const blocks=[];for(const [name,bytes]of files){const header=Buffer.alloc(512);header.write(name);header.write('0000644\0',100);header.write(bytes.length.toString(8).padStart(11,'0')+'\0',124);header.write('0',156);header.fill(32,148,156);const checksum=header.reduce((sum,byte)=>sum+byte,0);header.write(checksum.toString(8).padStart(6,'0')+'\0 ',148);blocks.push(header,bytes,Buffer.alloc((512-bytes.length%512)%512));}return Buffer.concat([...blocks,Buffer.alloc(1024)]);}
function proof({repository=C.REPOSITORY,revision=commit,indexAsImage=false,user='node'}={}){
 const config=Buffer.from(JSON.stringify({os:'linux',architecture:'amd64',config:{User:user,Cmd:['node','/run/hanq-production/bootstrap.mjs'],Labels:{'org.opencontainers.image.source':'https://github.com/'+repository,'org.opencontainers.image.revision':revision}}})),configId='sha256:'+C.hash(config);
 const manifest=Buffer.from(JSON.stringify(indexAsImage?{schemaVersion:2,manifests:[]}:{schemaVersion:2,config:{digest:configId},layers:[]})),imageId='sha256:'+C.hash(manifest),index=Buffer.from(JSON.stringify({manifests:[{digest:imageId}]}));
 return {bytes:tar([['index.json',index],['blobs/sha256/'+imageId.slice(7),manifest],['blobs/sha256/'+configId.slice(7),config]]),expected:{imageId,configId,sourceCommit:commit}};
}
test('manual new-repository identity is bound to exact main commit and workflow',()=>{assert.equal(C.identity(env(),commit,false).runId,'123');});
test('old producer, PR, branch and workflow substitution are rejected',()=>{for(const change of [{GITHUB_REPOSITORY:'blockmonkey1992/hanq_api'},{GITHUB_EVENT_NAME:'pull_request'},{GITHUB_REF:'refs/heads/dev'},{GITHUB_WORKFLOW_REF:C.REPOSITORY+'/.github/workflows/ci.yml@refs/heads/main'},{GITHUB_SHA:'b'.repeat(40)}])assert.throws(()=>C.identity({...env(),...change},commit,false));});
test('local identity has no fabricated run and cannot be selected inside Actions',()=>{const id=C.identity({},commit,true);assert.equal(id.runId,null);assert.equal(id.authenticated,false);assert.throws(()=>C.identity(env(),commit,true));});
test('a single OCI runtime manifest binds configuration and source',()=>{const p=proof();assert.equal(C.verifyOciArchive(p.bytes,p.expected).singleManifestVerified,true);});
test('an attestation/index digest cannot stand in for a runtime image manifest',()=>{const p=proof({indexAsImage:true});assert.throws(()=>C.verifyOciArchive(p.bytes,p.expected),/single image manifest/);});
test('source and root-user substitution fail archive validation',()=>{for(const change of [{repository:'blockmonkey1992/hanq_api'},{revision:'b'.repeat(40)},{user:'root'}]){const p=proof(change);assert.throws(()=>C.verifyOciArchive(p.bytes,p.expected));}});
test('missing and corrupted OCI proof fail closed',()=>{const p=proof();assert.throws(()=>C.verifyOciArchive(Buffer.alloc(1024),p.expected));const corrupt=Buffer.from(p.bytes);corrupt[1024+512]^=1;assert.throws(()=>C.verifyOciArchive(corrupt,p.expected));});
test('corrupted archive headers are rejected before reading proof bytes',()=>{const p=proof(),corrupt=Buffer.from(p.bytes);corrupt[101]^=1;assert.throws(()=>C.verifyOciArchive(corrupt,p.expected),/header checksum/);});
test('image build never manufactures any of six successful qualification suites',()=>{const q=C.qualification();assert.equal(q.productionQualified,false);assert.equal(q.requiredSuites.length,6);assert(q.requiredSuites.every(suite=>suite.status==='not_run'&&suite.conclusion==='unverified'));});
test('CD handoff rejects unqualified receipts and preserves required private audio',()=>{const result=handoff.inspect({kind:'api-image-build-only',repository:C.REPOSITORY,sourceCommit:commit,mode:'local-unqualified',authenticated:false,productionQualified:false},"const REPOSITORY='blockmonkey1992/hanq_api',WORKFLOW='.github/workflows/functional.yml';const required=['/run/hanq-ca/ca.crt'];");assert.equal(result.ready,false);assert(result.missingApprovedTargets.includes('/run/hanq-private-toeic-audio'));assert(result.missingApprovedTargets.includes('/app/private-textbook-semantic-data'));assert.equal(result.applyPerformed,false);});

test('source inventory retains the exact schema54 baseline and requires an explicit image profile for056',()=>{
 const S=require('./schema54-contract.cjs'),P=require('./migration-build-profile.cjs'),path=require('node:path'),root=path.resolve(__dirname,'..');
 const head=C.git(root,['rev-parse','HEAD']).trim(),fixture=JSON.parse(C.git(root,['show',head+':test/fixtures/migration-manifest-20261030.json']));
 const profile=fixture.migrations.some(row=>/^056_/.test(row.version))?P.SCHEMA55_IMAGE_ONLY:P.SCHEMA54,source=C.sourceManifest(root,head,profile);
 assert.deepEqual(source.rows.filter(row=>!/^056_/.test(row.version)),S.baselineRows());assert.equal(source.privilegesSha256,S.PRIVILEGES_SHA256);
 assert.equal(source.manifestSha256,profile===P.SCHEMA54?S.MANIFEST_SHA256:P.SCHEMA55_MANIFEST_SHA256);
 if(profile===P.SCHEMA55_IMAGE_ONLY)assert.throws(()=>C.sourceManifest(root,head),/schema-preserving schema54/);
 const rows=S.baselineRows();assert.equal(rows.length,54);assert(!rows.some(row=>/^047_/.test(row.version)));assert(rows.some(row=>/^055_/.test(row.version)));
 assert.deepEqual(S.validateRows([...rows].reverse()),rows);
});
test('same-count migration substitution, checksum changes and privileges drift fail closed',()=>{
 const S=require('./schema54-contract.cjs');
 for(const change of [rows=>{rows[0].checksum='0'.repeat(64);},rows=>{rows[0].version='001_replaced.sql';},rows=>{rows[0].version='047_not_in_baseline.sql';},rows=>{rows[0]={...rows[1]};}]){
  const rows=S.baselineRows();change(rows);assert.throws(()=>S.validateRows(rows));
 }
 assert.throws(()=>S.validateManifest({migrations:S.baselineRows(),privilegesSha256:'0'.repeat(64)}),/privileges differ/);
});
test('schema55 cannot borrow schema54 image or migration qualification',()=>{
 const S=require('./schema54-contract.cjs'),rows=S.baselineRows();
 // Synthetic metadata only: even the provided 056 checksum cannot qualify an untested upgrade.
 rows.push({version:'056_synthetic_candidate.sql',checksum:'13eeb81ff165a6ad1ad03aa2c1793ede79e020cdd5cc5383917fe740cd6796ab'});
 assert.throws(()=>S.validateRows(rows),/separately reviewed restore, upgrade and rollback/);
});
